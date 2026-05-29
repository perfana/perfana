import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import { SocketIOAdapter } from './socket-io.adapter';

jest.mock('socket.io', () => ({
  Server: jest.fn().mockImplementation(() => ({ mocked: true })),
}));

const MockServer = Server as jest.MockedClass<typeof Server>;

describe('SocketIOAdapter', () => {
  let adapter: SocketIOAdapter;
  let mockApp: jest.Mocked<INestApplication>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockHttpServer: object;

  beforeEach(() => {
    jest.clearAllMocks();

    mockHttpServer = { listen: jest.fn() };
    mockApp = {
      getHttpServer: jest.fn().mockReturnValue(mockHttpServer),
    } as unknown as jest.Mocked<INestApplication>;

    mockConfigService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    // Prevent the IoAdapter constructor from accessing the real httpServer
    jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue({} as Server);

    adapter = new SocketIOAdapter(mockApp, mockConfigService);
  });

  describe('createIOServer', () => {
    describe('when port === 0 (Docker shared-server mode)', () => {
      it('calls getHttpServer() and attaches Socket.IO to the existing HTTP server', () => {
        mockConfigService.get.mockReturnValue(undefined);

        adapter.createIOServer(0);

        expect(mockApp.getHttpServer).toHaveBeenCalled();
        expect(MockServer).toHaveBeenCalledWith(mockHttpServer, expect.any(Object));
      });

      it('does NOT delegate to super.createIOServer when port === 0', () => {
        mockConfigService.get.mockReturnValue(undefined);
        const superSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer');

        adapter.createIOServer(0);

        expect(superSpy).not.toHaveBeenCalled();
      });

      it('includes CORS config with default origins when env vars are absent', () => {
        mockConfigService.get.mockReturnValue(undefined);

        adapter.createIOServer(0);

        expect(MockServer).toHaveBeenCalledWith(
          mockHttpServer,
          expect.objectContaining({
            cors: expect.objectContaining({
              origin: ['http://localhost:4001', 'http://localhost:4002'],
              credentials: true,
              methods: ['GET', 'POST'],
            }),
            transports: ['websocket', 'polling'],
          }),
        );
      });

      it('uses CORS_ALLOWED_ORIGINS when set', () => {
        mockConfigService.get.mockImplementation((key: string) => {
          if (key === 'CORS_ALLOWED_ORIGINS') return 'https://app.example.com, https://admin.example.com';
          return undefined;
        });

        adapter.createIOServer(0);

        expect(MockServer).toHaveBeenCalledWith(
          mockHttpServer,
          expect.objectContaining({
            cors: expect.objectContaining({
              origin: ['https://app.example.com', 'https://admin.example.com'],
            }),
          }),
        );
      });

      it('uses FRONTEND_URL when CORS_ALLOWED_ORIGINS is absent', () => {
        mockConfigService.get.mockImplementation((key: string) => {
          if (key === 'FRONTEND_URL') return 'https://my-app.example.com';
          return undefined;
        });

        adapter.createIOServer(0);

        expect(MockServer).toHaveBeenCalledWith(
          mockHttpServer,
          expect.objectContaining({
            cors: expect.objectContaining({
              origin: ['https://my-app.example.com', 'http://localhost:4002'],
            }),
          }),
        );
      });

      it('merges caller-supplied options with server options', () => {
        mockConfigService.get.mockReturnValue(undefined);
        const extra = { pingTimeout: 5000 };

        adapter.createIOServer(0, extra as never);

        expect(MockServer).toHaveBeenCalledWith(
          mockHttpServer,
          expect.objectContaining({ pingTimeout: 5000 }),
        );
      });
    });

    describe('when port !== 0 (non-Docker mode)', () => {
      it('delegates to super.createIOServer with merged options', () => {
        mockConfigService.get.mockReturnValue(undefined);
        const superSpy = jest.spyOn(IoAdapter.prototype, 'createIOServer');

        adapter.createIOServer(3001);

        expect(superSpy).toHaveBeenCalledWith(
          3001,
          expect.objectContaining({
            cors: expect.objectContaining({ credentials: true }),
            transports: ['websocket', 'polling'],
          }),
        );
        expect(mockApp.getHttpServer).not.toHaveBeenCalled();
      });

      it('does NOT create a new Server instance directly', () => {
        mockConfigService.get.mockReturnValue(undefined);

        adapter.createIOServer(3001);

        expect(MockServer).not.toHaveBeenCalled();
      });
    });
  });
});
