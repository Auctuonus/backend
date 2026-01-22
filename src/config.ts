import { RabbitMQConfig } from '@golevelup/nestjs-rabbitmq';

const configuration = () => ({
  port: parseInt(process.env.PORT ?? '3000', 10) || 3000,
  mongodbUrl: process.env.MONGODB_URL ?? 'mongodb://localhost:27017/auctionus',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10) || 6379,
  },
  rabbitmq: {
    uri: process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
    connectionInitOptions: { wait: true, timeout: 5000 },
    exchanges: [
      {
        name: 'delayed.ex',
        type: 'x-delayed-message',
        options: {
          durable: true,
          arguments: {
            'x-delayed-type': 'direct',
          },
        },
      },
    ],
    queues: [
      {
        name: 'jobs.q',
        options: { durable: true },
        routingKey: 'jobs',
        exchange: 'delayed.ex',
      },
      {
        name: 'auction.processing.q',
        options: { durable: true },
        routingKey: 'auction.processing',
        exchange: 'delayed.ex',
      },
    ],
    enableControllerDiscovery: true,
  } as RabbitMQConfig,
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
