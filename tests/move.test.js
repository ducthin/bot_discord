const { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField, RESTJSONErrorCodes } = require('discord.js');
const move = require('../commands/move');
const undo = require('../commands/move-undo');
const call = require('../commands/call');
const { handleButton } = require('../handlers/interactionHandler');

const { ViewChannel, Connect, MoveMembers } = PermissionFlagsBits;
afterEach(() => jest.useRealTimers());

function moveInteraction() {
    const member = { id: 'moderator' };
    const bot = { id: 'bot' };
    const channel = id => {
        const allowed = new Map([
            [member, new PermissionsBitField([ViewChannel, Connect, MoveMembers])],
            [bot, new PermissionsBitField([ViewChannel, Connect, MoveMembers])]
        ]);
        return { id, allowed, isVoiceBased: () => true, permissionsFor: actor => allowed.get(actor) };
    };
    const source = channel('source');
    const destination = channel('destination');
    const target = { id: 'listener', user: { id: 'listener', bot: false }, voice: { channel: source, setChannel: jest.fn().mockResolvedValue() } };
    const interaction = {
        guild: {
            id: 'guild', members: { me: bot, cache: new Map([[target.id, target], [member.id, member]]) },
            channels: { cache: new Map([[source.id, source], [destination.id, destination]]) }
        },
        member,
        options: { getMember: () => target, getChannel: () => ({ id: destination.id }) },
        deferReply: jest.fn(), editReply: jest.fn()
    };
    return { interaction, source, destination, target, member, bot };
}

test('move uses a voice-channel picker and sends no optional audit reason', async () => {
    const { interaction, destination, target } = moveInteraction();
    const data = move.data.toJSON();
    expect(data.default_member_permissions).toBe(String(MoveMembers));
    expect(data.options[1].channel_types).toEqual([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

    await move.execute(interaction);
    expect(target.voice.setChannel).toHaveBeenCalledWith(destination);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
        content: '✅ Đã chuyển <@listener> sang <#destination>. Dùng /move-undo trong 5 phút để hoàn tác.',
        allowedMentions: { parse: [] }
    });
});

test.each([
    ['caller missing Move Members at source', fixture => fixture.source.allowed.get(fixture.member).remove(MoveMembers), 'Bạn cần quyền'],
    ['caller missing Move Members at destination', fixture => fixture.destination.allowed.get(fixture.member).remove(MoveMembers), 'Bạn cần quyền'],
    ['bot missing Connect at destination', fixture => fixture.destination.allowed.get(fixture.bot).remove(Connect), 'Bot cần quyền'],
    ['target disconnected', fixture => { fixture.target.voice.channel = null; }, 'không ở kênh thoại'],
    ['target already in destination', fixture => { fixture.target.voice.channel = fixture.destination; }, 'đã ở kênh đích'],
    ['destination is a text channel', fixture => { fixture.destination.isVoiceBased = () => false; }, 'Hãy chọn một kênh thoại']
])('move blocks %s', async (_name, change, message) => {
    const fixture = moveInteraction();
    change(fixture);
    await move.execute(fixture.interaction);
    expect(fixture.target.voice.setChannel).not.toHaveBeenCalled();
    expect(fixture.interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(message) }));
});

test('move reports when a member disconnects while Discord processes the request', async () => {
    const { interaction, target } = moveInteraction();
    target.voice.setChannel.mockRejectedValue({ code: RESTJSONErrorCodes.TargetUserIsNotConnectedToVoice });
    await move.execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('vừa rời kênh thoại') }));
});

test('undo uses only the caller’s last successful move and consumes it on success', async () => {
    const { interaction, source, destination, target } = moveInteraction();
    await move.execute(interaction);
    target.voice.channel = destination;
    await undo.execute({ ...interaction, member: { id: 'another moderator' } });
    expect(target.voice.setChannel).toHaveBeenCalledTimes(1);
    await undo.execute(interaction);
    await undo.execute(interaction);
    expect(target.voice.setChannel).toHaveBeenCalledTimes(2);
    expect(target.voice.setChannel).toHaveBeenLastCalledWith(source);
});

test('undo refuses when the target has left the destination or the move has expired', async () => {
    jest.useFakeTimers();
    const { interaction, destination, target } = moveInteraction();
    await move.execute(interaction);
    await undo.execute(interaction);
    expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('không còn ở phòng') }));
    target.voice.channel = destination;
    jest.setSystemTime(Date.now() + 300000);
    await undo.execute(interaction);
    expect(interaction.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('chưa có lần /move') }));
    expect(target.voice.setChannel).toHaveBeenCalledTimes(1);
});

async function sendCall() {
    const fixture = moveInteraction();
    const { interaction, member, destination, target } = fixture;
    member.voice = { channel: destination };
    destination.allowed.set(target, new PermissionsBitField([ViewChannel, Connect]));
    interaction.channel = { permissionsFor: () => new PermissionsBitField(ViewChannel) };
    interaction.reply = jest.fn().mockResolvedValue();
    interaction.editReply.mockResolvedValue();
    await call.execute(interaction);
    const payload = interaction.reply.mock.calls[0][0];
    const customId = payload.components[0].toJSON().components[0].custom_id;
    const button = {
        customId, guild: interaction.guild, member: target, user: target.user, isRepliable: () => true,
        reply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn()
    };
    return { ...fixture, button, payload };
}

test('call mentions only the recipient and moves them once after their consent', async () => {
    jest.useFakeTimers();
    const { button, target, destination, payload } = await sendCall();
    expect(payload.allowedMentions).toEqual({ parse: [], users: [target.id] });
    await handleButton({ ...button, user: { id: 'stranger' } });
    expect(target.voice.setChannel).not.toHaveBeenCalled();
    await handleButton(button);
    await handleButton(button);
    expect(target.voice.setChannel).toHaveBeenCalledTimes(1);
    expect(target.voice.setChannel).toHaveBeenLastCalledWith(destination);
    expect(button.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ components: [] }));
});

test('call rechecks room access before moving someone and expires unanswered invites', async () => {
    jest.useFakeTimers();
    const accepted = await sendCall();
    accepted.destination.allowed.get(accepted.target).remove(Connect);
    await handleButton(accepted.button);
    expect(accepted.target.voice.setChannel).not.toHaveBeenCalled();

    const expired = await sendCall();
    await jest.advanceTimersByTimeAsync(60000);
    expect(expired.interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('hết hạn'), components: [] }));
    await handleButton(expired.button);
    expect(expired.target.voice.setChannel).not.toHaveBeenCalled();
});
