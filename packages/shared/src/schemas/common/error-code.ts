import { errorCodeSchema } from '../../errors/errorCodes.js';

/**
 * Re-export of the canonical error code Zod schema. The `ErrorCode`
 * runtime value (a `const` object) and the `ErrorCodeValue` type are
 * already exported by `@mercadoexpress/shared/errors/errorCodes.js`;
 * the schema module only adds the runtime schema helper.
 */
export { errorCodeSchema };
