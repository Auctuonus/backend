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

  injectSwagger(app);

  await app.listen(3001);
}
void bootstrap();
