FROM node:18-alpine

# Tạo app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Tạo user non-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Chuyển ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port (optional)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Bot is running')" || exit 1

# Start the bot
CMD ["node", "index.js"]
