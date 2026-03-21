import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { HttpService } from '@nestjs/axios';

describe('AuthController', () => {
  let controller: AuthController;

  const mockHttpService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      const result = controller.getHealth();

      expect(result).toEqual({
        status: 'ok',
        module: 'auth',
      });
    });
  });

  // TODO: Add tests for Keycloak authentication endpoints when implemented
  // - Token validation
  // - User info retrieval
  // - Token refresh
  // - Logout
});
