import { Test, TestingModule } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { HttpException } from '@nestjs/common';

describe('EventsController', () => {
  let controller: EventsController;
  let service: any;

  const mockCtx = { userId: 'user-1', roles: ['user'], organizations: [] };

  const mockEvent = {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Deployment v2.3.1',
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        {
          provide: EventsService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([mockEvent]),
            findByTestRun: jest.fn().mockResolvedValue([mockEvent]),
            findOne: jest.fn().mockResolvedValue(mockEvent),
            create: jest.fn().mockResolvedValue(mockEvent),
            update: jest.fn().mockResolvedValue(mockEvent),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    service = module.get(EventsService);
  });

  describe('findAll', () => {
    it('should delegate to service.findAll', async () => {
      const result = await controller.findAll({}, mockCtx as any);
      expect(result).toEqual([mockEvent]);
      expect(service.findAll).toHaveBeenCalledWith('user-1', ['user'], {});
    });
  });

  describe('findByTestRun', () => {
    it('should delegate to service.findByTestRun', async () => {
      const result = await controller.findByTestRun('tr-1', mockCtx as any);
      expect(result).toEqual([mockEvent]);
      expect(service.findByTestRun).toHaveBeenCalledWith('tr-1', 'user-1', ['user']);
    });

    it('should throw 404 for not found', async () => {
      service.findByTestRun.mockRejectedValue(new Error('Test run tr-1 not found'));
      await expect(controller.findByTestRun('tr-1', mockCtx as any))
        .rejects.toThrow(HttpException);
    });
  });

  describe('findOne', () => {
    it('should delegate to service.findOne', async () => {
      const result = await controller.findOne(mockEvent.id, mockCtx as any);
      expect(result).toEqual(mockEvent);
    });
  });

  describe('create', () => {
    it('should delegate to service.create', async () => {
      const dto = { title: 'Deploy', systemUnderTest: 'svc', testEnvironment: 'prod', timestamp: '2024-01-01T00:00:00Z' };
      const result = await controller.create(dto as any, mockCtx as any);
      expect(result).toEqual(mockEvent);
      expect(service.create).toHaveBeenCalledWith(dto, 'user-1', ['user']);
    });
  });

  describe('update', () => {
    it('should delegate to service.update', async () => {
      const dto = { title: 'Updated' };
      const result = await controller.update(mockEvent.id, dto as any, mockCtx as any);
      expect(result).toEqual(mockEvent);
    });
  });

  describe('remove', () => {
    it('should delegate to service.remove', async () => {
      const result = await controller.remove(mockEvent.id, mockCtx as any);
      expect(result).toEqual({ message: 'Event deleted successfully' });
    });
  });
});
