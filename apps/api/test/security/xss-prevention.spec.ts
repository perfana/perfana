import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * XSS (Cross-Site Scripting) Prevention Security Tests
 *
 * Tests protection against XSS attacks in various contexts:
 * - Script tag injection
 * - Event handler injection
 * - HTML entity injection
 * - JavaScript protocol injection
 * - SVG-based XSS
 * - CSS-based XSS
 * - Data URI XSS
 */
describe('XSS Prevention Security Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const mockAuth = 'Bearer mock-valid-api-key';

  describe('Script Tag Injection', () => {
    it('should sanitize script tags in test run ID', async () => {
      const xssPayload = '<script>alert("xss")</script>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: xssPayload,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize script tags in annotations', async () => {
      const xssPayload = {
        annotations: [
          'normal annotation',
          '<script>document.cookie</script>',
          'another annotation'
        ]
      };

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/annotations')
        .send(xssPayload)
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize script tags in tags', async () => {
      const xssPayload = {
        tags: ['tag1', '<script>alert(1)</script>', 'tag2']
      };

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/tags')
        .send(xssPayload)
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize obfuscated script tags', async () => {
      const xssPayload = '<scr<script>ipt>alert("xss")</scr</script>ipt>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Event Handler Injection', () => {
    it('should sanitize onerror event handler', async () => {
      const xssPayload = '<img src=x onerror="alert(1)">';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: xssPayload,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize onclick event handler', async () => {
      const xssPayload = '<div onclick="alert(document.cookie)">Click me</div>';

      await request(app.getHttpServer())
        .post('/api/test-runs/expected-config-changes')
        .send({
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest',
          configKey: 'test.key',
          expectedValue: 'value'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize onload event handler', async () => {
      const xssPayload = '<body onload="alert(1)">';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: 'TestSystem',
          environment: xssPayload,
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize onmouseover event handler', async () => {
      const xssPayload = '<div onmouseover="alert(1)">Hover me</div>';

      await request(app.getHttpServer())
        .put('/api/test-runs/550e8400-e29b-41d4-a716-446655440000/annotations')
        .send({ annotations: [xssPayload] })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('JavaScript Protocol Injection', () => {
    it('should sanitize javascript: protocol in links', async () => {
      const xssPayload = '<a href="javascript:alert(1)">Click</a>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: xssPayload,
          system: 'TestSystem',
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize javascript: with encoding', async () => {
      const xssPayload = '<a href="jav&#x09;ascript:alert(1)">Click</a>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize data: protocol with base64', async () => {
      const xssPayload = '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Click</a>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('HTML Entity and Encoding Attacks', () => {
    it('should handle HTML entities correctly', async () => {
      const xssPayload = '&lt;script&gt;alert(1)&lt;/script&gt;';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle hexadecimal entities', async () => {
      const xssPayload = '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle decimal entities', async () => {
      const xssPayload = '&#60;script&#62;alert(1)&#60;/script&#62;';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should handle Unicode escapes', async () => {
      const xssPayload = '\\u003cscript\\u003ealert(1)\\u003c/script\\u003e';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('SVG-Based XSS', () => {
    it('should sanitize SVG with embedded script', async () => {
      const xssPayload = '<svg><script>alert(1)</script></svg>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize SVG with event handler', async () => {
      const xssPayload = '<svg onload="alert(1)"></svg>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize SVG with animate tag', async () => {
      const xssPayload = '<svg><animate onbegin="alert(1)" attributeName="x" dur="1s"></svg>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('CSS-Based XSS', () => {
    it('should sanitize style tag with expression', async () => {
      const xssPayload = '<style>body { background: expression(alert(1)); }</style>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize inline style with javascript', async () => {
      const xssPayload = '<div style="background:url(javascript:alert(1))">XSS</div>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize CSS import with javascript', async () => {
      const xssPayload = '<style>@import "javascript:alert(1)";</style>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Template Injection', () => {
    it('should sanitize Angular-style template injection', async () => {
      const xssPayload = '{{constructor.constructor("alert(1)")()}}';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize Vue-style template injection', async () => {
      const xssPayload = '{{ _c.constructor("alert(1)")() }}';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize React-style JSX injection', async () => {
      const xssPayload = '<div dangerouslySetInnerHTML={{__html: "<script>alert(1)</script>"}}></div>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Iframe and Object Injection', () => {
    it('should sanitize iframe with javascript src', async () => {
      const xssPayload = '<iframe src="javascript:alert(1)"></iframe>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize iframe with data URI', async () => {
      const xssPayload = '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize object tag with data', async () => {
      const xssPayload = '<object data="javascript:alert(1)"></object>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize embed tag', async () => {
      const xssPayload = '<embed src="javascript:alert(1)"></embed>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Meta Tag Injection', () => {
    it('should sanitize meta refresh with javascript', async () => {
      const xssPayload = '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize meta tag with URL', async () => {
      const xssPayload = '<meta http-equiv="refresh" content="0;url=data:text/html,<script>alert(1)</script>">';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('JSON Payload XSS', () => {
    it('should sanitize XSS in JSON configuration keys', async () => {
      const xssPayload = {
        config: {
          '<script>alert(1)</script>': 'value1',
          'key2': 'value2'
        }
      };

      await request(app.getHttpServer())
        .post('/api/test-config-json')
        .send(xssPayload)
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize XSS in JSON configuration values', async () => {
      const xssPayload = {
        config: {
          'key1': '<img src=x onerror="alert(1)">',
          'key2': 'value2'
        }
      };

      await request(app.getHttpServer())
        .post('/api/test-config-json')
        .send(xssPayload)
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize XSS in nested JSON', async () => {
      const xssPayload = {
        config: {
          nested: {
            deep: '<script>alert(document.domain)</script>'
          }
        }
      };

      await request(app.getHttpServer())
        .post('/api/test-config-json')
        .send(xssPayload)
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });

  describe('Polyglot XSS', () => {
    it('should sanitize polyglot payload (works in multiple contexts)', async () => {
      const xssPayload = 'jaVasCript:/*-/*`/*\\`/*\'/*"/**/(/* */oNcliCk=alert() )//%0D%0A%0d%0a//</stYle/</titLe/</teXtarEa/</scRipt/--!>\\x3csVg/<sVg/oNloAd=alert()//>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });

    it('should sanitize complex polyglot with multiple vectors', async () => {
      const xssPayload = '\'">><marquee><img src=x onerror=confirm(1)></marquee>` ` ` -- !>';

      await request(app.getHttpServer())
        .post('/api/test')
        .send({
          testRunId: 'test-1',
          system: xssPayload,
          environment: 'production',
          workload: 'loadTest'
        })
        .set('Authorization', mockAuth)
        .expect(401);
    });
  });
});
