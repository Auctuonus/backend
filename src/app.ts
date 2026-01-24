import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import injectSwagger from './utils/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {});

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

  // Setup Swagger documentation
  injectSwagger(app);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
