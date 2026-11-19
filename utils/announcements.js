const { ChannelType, PermissionFlagsBits, RESTJSONErrorCodes, Routes } = require('discord.js');
const { randomUUID } = require('node:crypto');
const store = require('./managementStore');
const { isGuildAllowed } = require('./guildUtils');
const { hasChannelPermissions } = require('./managementAccess');

const RETRY_WINDOW = 2 * 60 * 1000;
const RETRY_DELAY = 15000;
const DELIVERY_LEASE = 60_000;
const postPermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];

function announcementChannel(guild, channelId, member) {
    const channel = guild.channels.cache.get(channelId);
    if (channel?.type !== ChannelType.GuildText || !member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return null;
    if (!hasChannelPermissions(channel, member, postPermissions) ||
        !hasChannelPermissions(channel, guild.members.me, postPermissions)) return null;
    return channel;
}

async function sendDueAnnouncements(guild, canSend = () => true) {
    const processed = new Set();
    for (let index = 0; index < 5 && canSend(); index++) {
        // A committed lease reserves the post without keeping the guild's SQL
        // transaction open while Discord fetches a member or sends a message.
        const claim = await store.transact(guild.id, async (state, save) => {
            if (!canSend()) return null;
            const now = Date.now();
            const due = Object.values(state.announcements)
                .filter(post => !processed.has(post.id) && !(post.deliveryLeaseUntil > now) &&
                    ((post.status === 'pending' && post.sendAt <= now) ||
                     (post.status === 'sending' && post.lastAttempt + RETRY_DELAY <= now)))
                .sort((first, second) => first.sendAt - second.sendAt);
            let changed = false;
            for (const post of due) {
                const resuming = post.status === 'sending';
                if (resuming && now - post.firstAttempt >= RETRY_WINDOW) {
                    post.status = 'unknown';
                    delete post.deliveryToken;
                    delete post.deliveryLeaseUntil;
                    changed = true;
                    continue;
                }
                post.deliveryToken = randomUUID();
                post.deliveryLeaseUntil = now + DELIVERY_LEASE;
                await save();
                return { ...post, resuming };
            }
            if (changed) await save();
            return null;
        });
        if (!claim) break;
        processed.add(claim.id);

        const finish = update => store.transact(guild.id, async (state, save) => {
            const post = state.announcements[claim.id];
            if (!post || post.deliveryToken !== claim.deliveryToken) return;
            update(post);
            delete post.deliveryToken;
            delete post.deliveryLeaseUntil;
            await save();
        });

        let member;
        try {
            member = await guild.members.fetch({ user: claim.authorId, force: true });
        } catch (error) {
            if (error.code !== RESTJSONErrorCodes.UnknownMember) {
                await finish(() => {});
                throw error;
            }
        }
        const channel = announcementChannel(guild, claim.channelId, member);
        if (!channel) {
            await finish(post => {
                if (post.status === 'pending' || post.status === 'sending') post.status = claim.resuming ? 'unknown' : 'failed';
            });
            continue;
        }

        const ready = await store.transact(guild.id, async (state, save) => {
            const post = state.announcements[claim.id];
            if (!post || post.deliveryToken !== claim.deliveryToken) return null;
            if (!canSend() || !['pending', 'sending'].includes(post.status)) {
                delete post.deliveryToken;
                delete post.deliveryLeaseUntil;
                await save();
                return null;
            }
            const now = Date.now();
            if (claim.resuming && now - post.firstAttempt >= RETRY_WINDOW) {
                post.status = 'unknown';
                delete post.deliveryToken;
                delete post.deliveryLeaseUntil;
                await save();
                return null;
            }
            post.firstAttempt ??= now;
            post.lastAttempt = now;
            post.status = 'sending';
            post.deliveryLeaseUntil = now + DELIVERY_LEASE;
            await save();
            return { ...post };
        });
        if (!ready) continue;
        if (!canSend()) {
            await finish(post => {
                if (!claim.resuming && post.status === 'sending') {
                    post.status = 'pending';
                    delete post.firstAttempt;
                    delete post.lastAttempt;
                }
            });
            return;
        }

        let sent;
        let sendError;
        try {
            sent = await guild.client.rest.post(Routes.channelMessages(channel.id), {
                body: { content: ready.text, allowed_mentions: { parse: [] }, nonce: ready.nonce, enforce_nonce: true }
            });
        } catch (error) {
            sendError = error;
            console.error('Lỗi gửi thông báo #' + ready.id + ':', error.message);
        }
        await finish(post => {
            if (post.status !== 'sending') return;
            if (sent) {
                post.status = 'sent';
                post.messageId = sent.id;
            } else if ([400, 401, 403, 404].includes(sendError?.status)) {
                post.status = claim.resuming ? 'unknown' : 'failed';
            }
        });
    }
}

function startAnnouncementScheduler(client) {
    let stopped = false;
    let running = false;
    const canSend = () => !stopped && client.isReady();
    async function check() {
        if (running || !canSend()) return;
        running = true;
        try {
            const guilds = [...client.guilds.cache.values()].filter(guild => guild.available && isGuildAllowed(guild.id));
            await Promise.allSettled(guilds.map(async guild => {
                try {
                    await sendDueAnnouncements(guild, canSend);
                } catch (error) {
                    console.error('Lỗi kiểm tra thông báo đã hẹn:', error.message);
                }
            }));
        } finally {
            running = false;
        }
    }
    const timer = setInterval(() => void check(), RETRY_DELAY).unref();
    void check();
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

module.exports = { announcementChannel, sendDueAnnouncements, startAnnouncementScheduler };
