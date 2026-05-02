import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { RequestContextModule } from './request-context.module';

describe('RequestContextModule', () => {
  it('provides ClsService as global', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RequestContextModule],
    }).compile();

    const cls = moduleRef.get(ClsService, { strict: false });
    expect(cls).toBeDefined();
  });
});
