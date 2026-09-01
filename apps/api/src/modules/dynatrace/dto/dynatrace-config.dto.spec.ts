import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CreateDynatraceConfigDto } from './create-dynatrace-config.dto';
import { UpdateDynatraceConfigDto } from './update-dynatrace-config.dto';

/**
 * `clientUrl` is the browser-facing deep-link URL. Both create and update carry
 * `@ValidateIf(value !== '')` so an empty string passes validation on either verb:
 * on update it is how the edit dialog clears the field, and on create it lets a
 * client POST back a config it GET'd without special-casing a cleared value.
 * The service collapses '' to undefined on create; the repository writes NULL on
 * update, so the column has exactly one unset representation.
 *
 * The scheme is pinned (`protocols: ['http','https'], require_protocol: true`)
 * because the value is handed to window.open. With validator.js defaults the
 * protocol list is never consulted and 'evil.com' / 'ftp://evil.com' both pass.
 */
describe('Dynatrace config DTOs — clientUrl', () => {
  const validCreate = {
    host: 'https://example.live.dynatrace.com',
    apiToken: 'dt0c01.test.token',
    label: 'Production Dynatrace',
  };

  const errorsFor = async (dto: object) => validate(dto);

  describe('CreateDynatraceConfigDto', () => {
    it('accepts a payload with no clientUrl at all', async () => {
      const dto = plainToClass(CreateDynatraceConfigDto, { ...validCreate });

      expect(await errorsFor(dto)).toHaveLength(0);
    });

    it('accepts a valid absolute clientUrl', async () => {
      const dto = plainToClass(CreateDynatraceConfigDto, {
        ...validCreate,
        clientUrl: 'https://dynatrace.example.com',
      });

      expect(await errorsFor(dto)).toHaveLength(0);
    });

    it('accepts a TLD-less internal host (require_tld is off)', async () => {
      // Split-DNS deploys point the browser at names like https://dynatrace:9999
      const dto = plainToClass(CreateDynatraceConfigDto, {
        ...validCreate,
        clientUrl: 'https://dynatrace-internal:9999',
      });

      expect(await errorsFor(dto)).toHaveLength(0);
    });

    it('rejects a non-URL clientUrl with the custom message', async () => {
      const dto = plainToClass(CreateDynatraceConfigDto, {
        ...validCreate,
        clientUrl: 'not a url',
      });

      const errors = await errorsFor(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('clientUrl');
      expect(errors[0]?.constraints?.isUrl).toBe('Client URL must be a valid http(s) URL');
    });

    it('accepts an empty-string clientUrl, matching update', async () => {
      // A client that GETs a cleared config and POSTs it back must not get a 400.
      const dto = plainToClass(CreateDynatraceConfigDto, { ...validCreate, clientUrl: '' });

      expect(await errorsFor(dto)).toHaveLength(0);
    });

    it.each(['evil.com', 'ftp://evil.com', 'javascript:alert(1)'])(
      'rejects %s — the value is opened in the browser, so http(s) is the contract',
      async (bad) => {
        const dto = plainToClass(CreateDynatraceConfigDto, { ...validCreate, clientUrl: bad });

        const errors = await errorsFor(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('clientUrl');
      },
    );
  });

  describe('UpdateDynatraceConfigDto', () => {
    it('accepts an omitted clientUrl (leave it as it is)', async () => {
      const dto = plainToClass(UpdateDynatraceConfigDto, { label: 'Renamed' });

      expect(await errorsFor(dto)).toHaveLength(0);
    });

    it('accepts an empty string — this is how the edit dialog clears the field', async () => {
      const dto = plainToClass(UpdateDynatraceConfigDto, { clientUrl: '' });

      expect(await errorsFor(dto)).toHaveLength(0);
    });

    it('rejects a non-URL clientUrl with the custom message', async () => {
      const dto = plainToClass(UpdateDynatraceConfigDto, { clientUrl: 'not a url' });

      const errors = await errorsFor(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('clientUrl');
      expect(errors[0]?.constraints?.isUrl).toBe('Client URL must be a valid http(s) URL');
    });
  });
});
