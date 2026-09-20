import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// `import * as request` cho ra namespace của module CommonJS nên không gọi được như hàm;
// với "module": "nodenext" + esModuleInterop thì phải import mặc định.
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
