import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyState from './EmptyState.vue';
import Button from '@/components/atoms/Button.vue';

describe('EmptyState', () => {
  it('renders the message text', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'No hay productos todavía.' },
    });
    expect(wrapper.text()).toContain('No hay productos todavía.');
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true);
  });

  it('renders the optional action slot when provided', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'No hay órdenes.' },
      slots: { action: '<button class="cta">Crear primera</button>' },
    });
    expect(wrapper.find('.cta').exists()).toBe(true);
    expect(wrapper.text()).toContain('No hay órdenes.');
  });

  it('omits the action wrapper when no slot is provided', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Vacío' },
    });
    // The action wrapper uses justify-center + flex; ensure it is NOT rendered.
    expect(wrapper.find('.justify-center').exists()).toBe(false);
  });

  it('applies success tone class to the accent bar', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Todo en orden.', tone: 'success' },
    });
    expect(wrapper.find('[data-testid="empty-state"]').attributes('data-tone')).toBe('success');
    expect(wrapper.find('.bg-success').exists()).toBe(true);
  });

  it('defaults to neutral tone', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'Sin datos.' },
    });
    expect(wrapper.find('[data-testid="empty-state"]').attributes('data-tone')).toBe('neutral');
    expect(wrapper.find('.bg-muted').exists()).toBe(true);
  });

  it('integrates with the real Button atom in the action slot (regression)', () => {
    const wrapper = mount(EmptyState, {
      props: { message: 'No hay categorías.' },
      slots: { action: Button },
    });
    expect(wrapper.find('button').exists()).toBe(true);
  });
});
