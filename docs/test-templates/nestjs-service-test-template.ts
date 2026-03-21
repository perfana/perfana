/**
 * NestJS Service Test Template
 *
 * This template provides a comprehensive structure for testing NestJS services
 * with database operations, business logic, and error handling.
 *
 * Key Testing Areas:
 * 1. CRUD operations (Create, Read, Update, Delete)
 * 2. Business logic validation
 * 3. Error handling and exceptions
 * 4. Edge cases and boundary conditions
 * 5. Database query optimization
 * 6. Transaction handling (if applicable)
 *
 * Usage:
 * - Copy this template
 * - Replace YourService with your service name
 * - Replace YourRepository with your repository
 * - Replace YourEntity with your entity type
 * - Customize test cases based on your service's methods
 */

import { Test, TestingModule } from '@nestjs/testing';
import { YourService } from './your-service.service';
import { YourRepository } from './your-repository.repository';
import { YourEntity } from './your-entity.entity';
import {
  ResourceNotFoundException,
  ValidationException,
  DatabaseException,
} from '../../common/exceptions/business.exception';

describe('YourService', () => {
  let service: YourService;
  let repository: jest.Mocked<YourRepository>;

  // Mock data factory
  const createMockEntity = (overrides?: Partial<YourEntity>): YourEntity => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Entity',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourService,
        {
          provide: YourRepository,
          useValue: {
            findAll: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findByName: jest.fn(),
            // Add other repository methods
          },
        },
      ],
    }).compile();

    service = module.get<YourService>(YourService);
    repository = module.get(YourRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all entities sorted by creation date', async () => {
      // Arrange
      const mockEntities = [
        createMockEntity({ id: '1', name: 'Entity 1' }),
        createMockEntity({ id: '2', name: 'Entity 2' }),
      ];
      repository.findAll.mockResolvedValue(mockEntities);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual(mockEntities);
      expect(repository.findAll).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
    });

    it('should return empty array when no entities exist', async () => {
      // Arrange
      repository.findAll.mockResolvedValue([]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it('should throw DatabaseException on database error', async () => {
      // Arrange
      repository.findAll.mockRejectedValue(new Error('Connection failed'));

      // Act & Assert
      await expect(service.findAll()).rejects.toThrow(DatabaseException);
    });
  });

  describe('findOne', () => {
    it('should find entity by ID', async () => {
      // Arrange
      const mockEntity = createMockEntity();
      repository.findById.mockResolvedValue(mockEntity);

      // Act
      const result = await service.findOne(mockEntity.id);

      // Assert
      expect(result).toEqual(mockEntity);
      expect(repository.findById).toHaveBeenCalledWith(mockEntity.id);
    });

    it('should throw ResourceNotFoundException when entity not found', async () => {
      // Arrange
      const nonExistentId = 'non-existent-id';
      repository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        ResourceNotFoundException,
      );
      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        `YourEntity with ID ${nonExistentId} not found`,
      );
    });

    it('should throw DatabaseException on database error', async () => {
      // Arrange
      repository.findById.mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      await expect(service.findOne('some-id')).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  describe('create', () => {
    it('should create a new entity with valid data', async () => {
      // Arrange
      const createDto = { name: 'New Entity' };
      const mockCreatedEntity = createMockEntity(createDto);
      repository.create.mockResolvedValue(mockCreatedEntity);

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(result).toEqual(mockCreatedEntity);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining(createDto),
      );
    });

    it('should throw ValidationException for invalid data', async () => {
      // Arrange
      const invalidDto = { name: '' }; // Empty name

      // Act & Assert
      await expect(service.create(invalidDto)).rejects.toThrow(
        ValidationException,
      );
    });

    it('should throw DatabaseException when creation fails', async () => {
      // Arrange
      const createDto = { name: 'New Entity' };
      repository.create.mockRejectedValue(new Error('Insert failed'));

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(
        DatabaseException,
      );
    });
  });

  describe('update', () => {
    it('should update an existing entity', async () => {
      // Arrange
      const id = '123';
      const updateDto = { name: 'Updated Entity' };
      const existingEntity = createMockEntity({ id });
      const updatedEntity = createMockEntity({ id, ...updateDto });

      repository.findById.mockResolvedValue(existingEntity);
      repository.update.mockResolvedValue(updatedEntity);

      // Act
      const result = await service.update(id, updateDto);

      // Assert
      expect(result).toEqual(updatedEntity);
      expect(repository.update).toHaveBeenCalledWith(id, updateDto);
    });

    it('should throw ResourceNotFoundException for non-existent entity', async () => {
      // Arrange
      const id = 'non-existent';
      const updateDto = { name: 'Updated' };
      repository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.update(id, updateDto)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw ValidationException for invalid update data', async () => {
      // Arrange
      const id = '123';
      const invalidDto = { name: '' };

      // Act & Assert
      await expect(service.update(id, invalidDto)).rejects.toThrow(
        ValidationException,
      );
    });
  });

  describe('delete', () => {
    it('should delete an existing entity', async () => {
      // Arrange
      const id = '123';
      const existingEntity = createMockEntity({ id });
      repository.findById.mockResolvedValue(existingEntity);
      repository.delete.mockResolvedValue(undefined);

      // Act
      await service.delete(id);

      // Assert
      expect(repository.findById).toHaveBeenCalledWith(id);
      expect(repository.delete).toHaveBeenCalledWith(id);
    });

    it('should throw ResourceNotFoundException for non-existent entity', async () => {
      // Arrange
      const id = 'non-existent';
      repository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.delete(id)).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should throw DatabaseException on deletion error', async () => {
      // Arrange
      const id = '123';
      const existingEntity = createMockEntity({ id });
      repository.findById.mockResolvedValue(existingEntity);
      repository.delete.mockRejectedValue(new Error('Deletion failed'));

      // Act & Assert
      await expect(service.delete(id)).rejects.toThrow(DatabaseException);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values gracefully', async () => {
      // Arrange
      repository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('null')).rejects.toThrow(
        ResourceNotFoundException,
      );
    });

    it('should handle undefined values gracefully', async () => {
      // Arrange & Act & Assert
      await expect(service.findOne(undefined as any)).rejects.toThrow();
    });

    it('should handle concurrent operations safely', async () => {
      // Arrange
      const mockEntity = createMockEntity();
      repository.findById.mockResolvedValue(mockEntity);

      // Act
      const promises = [
        service.findOne(mockEntity.id),
        service.findOne(mockEntity.id),
        service.findOne(mockEntity.id),
      ];

      const results = await Promise.all(promises);

      // Assert
      expect(results).toHaveLength(3);
      results.forEach((result) => expect(result).toEqual(mockEntity));
    });
  });

  describe('Business Logic', () => {
    it('should validate business rules before creation', async () => {
      // Arrange
      const createDto = { name: 'Duplicate Name' };
      const existingEntity = createMockEntity({ name: 'Duplicate Name' });
      repository.findByName.mockResolvedValue(existingEntity);

      // Act & Assert
      await expect(service.create(createDto)).rejects.toThrow(
        ValidationException,
      );
      await expect(service.create(createDto)).rejects.toThrow(
        'Entity with this name already exists',
      );
    });

    it('should apply default values when not provided', async () => {
      // Arrange
      const createDto = { name: 'Entity' };
      const expectedEntity = createMockEntity({
        name: 'Entity',
        // Add default values
        status: 'active',
      });
      repository.create.mockResolvedValue(expectedEntity);

      // Act
      const result = await service.create(createDto);

      // Assert
      expect(result.status).toBe('active');
    });
  });
});
