import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { RunnerModule } from './app.module';
import injectSwagger from './utils/swagger';

async function bootstrap() {
  const app = await NestFactory.create(RunnerModule);

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS
  app.enableCors();

  // Set global prefix for all routes
  app.setGlobalPrefix('api');

  // Setup Swagger
  injectSwagger(app);

  await app.listen(3001);
}
bootstrap();
