const configuration = () => ({
  port: parseInt(process.env.PORT ?? '3000', 10) || 3000,
  mongodbUrl: process.env.MONGODB_URL ?? 'mongodb://localhost:27017/auctionus',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
  },
});

export default configuration;
export type Configuration = ReturnType<typeof configuration>;
