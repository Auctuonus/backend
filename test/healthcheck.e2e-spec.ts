import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';

import { TestAppContext, createTestWebApp, closeTestApp } from './utils';

describe('HealthcheckController (e2e)', () => {
  let app: INestApplication;
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestWebApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  describe('GET /healthcheck', () => {
    it('should return 200 OK', async () => {
      await request(app.getHttpServer()).get('/healthcheck').expect(200);
    });

    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/healthcheck')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });
});
