/**
 * Categories BC — Category aggregate (PR 2a, categories/spec.md).
 *
 * Invariants (categories/spec.md "Create category"):
 *   - name 2-40 chars, non-empty, unique across rows.
 */

export interface CategoryProps {
  id: string;
  name: string;
  createdAt?: Date;
}

export class Category {
  private constructor(public readonly props: CategoryProps) {}

  static create(input: { id: string; name: string; createdAt?: Date }): Category {
    Category.assertInvariants(input);
    return new Category({ ...input, name: input.name.trim() });
  }

  static rehydrate(props: CategoryProps): Category {
    return new Category({ ...props, name: props.name.trim() });
  }

  static assertInvariants(p: CategoryProps): void {
    if (!p.name || p.name.trim().length < 2 || p.name.trim().length > 40) {
      throw new Error('Category.name must be 2-40 chars');
    }
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }
  get createdAt(): Date | undefined {
    return this.props.createdAt;
  }

  toReadModel(): { id: string; name: string; createdAt: string } {
    return {
      id: this.props.id,
      name: this.props.name,
      createdAt: (this.props.createdAt ?? new Date(0)).toISOString(),
    };
  }
}
