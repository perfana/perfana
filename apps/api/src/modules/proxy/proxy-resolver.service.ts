import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProxyServer } from '../../entities';
import { buildProxyAgent, ProxyAgents } from '@perfana/shared/services/proxy';

@Injectable()
export class ProxyResolverService {
  constructor(
    @InjectRepository(ProxyServer)
    private readonly repo: Repository<ProxyServer>,
  ) {}

  async resolve(organizationId: string, useProxy: boolean): Promise<ProxyAgents | null> {
    if (!useProxy) return null;
    const row = await this.repo.findOne({ where: { organizationId } });
    return buildProxyAgent(row);
  }
}
