const configuration = () => ({
  port: parseInt(process.env.PORT ?? '3000', 10) || 3000,
  mongodbUrl: process.env.MONGODB_URL ?? 'mongodb://localhost:27017/auctionus',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'your-secret-change-in-production',
    authExpiresIn:
      parseInt(process.env.JWT_AUTH_EXPIRES_IN ?? '900', 10) || 900, // Default: 7 days in seconds
    refreshTokenExpiresIn:
      parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRES_IN ?? '604800', 10) ||
      604800, // Default: 7 days in seconds
  },
});

export default configuration;
export type Configuration = ReturnType<typeof configuration>;
