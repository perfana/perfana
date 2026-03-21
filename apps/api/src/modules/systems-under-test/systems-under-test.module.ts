import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemsUnderTestController } from './systems-under-test.controller';
import { SystemsUnderTestService } from './systems-under-test.service';
import { DeleteSystemUnderTestHandler } from './handlers/delete-system-under-test.handler';
import { SystemUnderTest, TestRun, PyroscopeInstance } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemUnderTest, TestRun, PyroscopeInstance]),
    CommonModule,
  ],
  controllers: [SystemsUnderTestController],
  providers: [SystemsUnderTestService, DeleteSystemUnderTestHandler],
  exports: [SystemsUnderTestService],
})
export class SystemsUnderTestModule {}
