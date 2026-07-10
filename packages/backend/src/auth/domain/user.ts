/**
 * Auth BC — User aggregate (PR 2a, design.md §3.4 + auth/spec.md).
 *
 * Pure domain entity — imports nothing from infrastructure (no Prisma,
 * no bcrypt, no jose). The `ports/` interfaces define the only allowed
 * persistence and security operations.
 *
 * Invariants enforced at construction (auth/spec.md "Seed registers
 * exactly one admin user" + "bcrypt cost 10" + "MVP is single-role"):
 *   - username 3-32 chars, [a-zA-Z0-9._-]
 *   - email RFC 5322-ish
 *   - passwordHash matches `$2[aby]$NN$...` and N === BCRYPT_COST (read
 *     from `process.env.BCRYPT_COST` so the seed and the use case agree)
 *   - role ∈ {ADMIN}
 */

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_HASH_REGEX = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export type Role = 'admin';

export interface UserProps {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

export class User {
  private constructor(public readonly props: UserProps) {}

  static create(input: {
    id: string;
    email: string;
    username: string;
    passwordHash: string;
    role?: Role;
    createdAt?: Date;
  }): User {
    User.assertInvariants({
      id: input.id,
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      role: input.role ?? 'admin',
      createdAt: input.createdAt ?? new Date(),
    });
    return new User({
      id: input.id,
      email: input.email.toLowerCase(),
      username: input.username.toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role ?? 'admin',
      createdAt: input.createdAt ?? new Date(),
    });
  }

  static rehydrate(props: UserProps): User {
    return new User({
      ...props,
      email: props.email.toLowerCase(),
      username: props.username.toLowerCase(),
    });
  }

  static assertInvariants(props: UserProps): void {
    if (!USERNAME_REGEX.test(props.username)) {
      throw new Error('User.username must be 3-32 chars: letters, digits, . _ -');
    }
    if (!EMAIL_REGEX.test(props.email)) {
      throw new Error(`User.email is not a valid email: ${props.email}`);
    }
    if (!BCRYPT_HASH_REGEX.test(props.passwordHash)) {
      throw new Error('User.passwordHash is not a bcrypt $2[aby]$NN$... hash');
    }
    const expectedCost = Number(process.env['BCRYPT_COST'] ?? 10);
    const match = /^\$2[aby]\$(\d{2})\$/.exec(props.passwordHash);
    if (match) {
      const actualCost = Number(match[1]);
      if (actualCost !== expectedCost) {
        throw new Error(
          `User.passwordHash bcrypt cost (${actualCost}) does not match BCRYPT_COST env (${expectedCost})`,
        );
      }
    }
    if (props.role !== 'admin') {
      throw new Error(`User.role must be 'admin' in MVP (got '${props.role}')`);
    }
  }

  get id(): string {
    return this.props.id;
  }
  get email(): string {
    return this.props.email;
  }
  get username(): string {
    return this.props.username;
  }
  get passwordHash(): string {
    return this.props.passwordHash;
  }
  get role(): Role {
    return this.props.role;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
