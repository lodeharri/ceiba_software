/**
 * RISK-W01 — XSS payload renders as literal text in the SPA.
 *
 * The e2e suite (`e2e/xss-text.spec.ts`) confirms the API stores the payload
 * verbatim. This unit test confirms the frontend components render that same
 * payload as plain text — NOT as an executable `<script>` tag.
 *
 * Vue's default text interpolation (`{{ }}`) and attribute binding
 * (`:value`, `:placeholder`) HTML-escape their input. The test pins that
 * contract so a future refactor that swaps to `v-html` or `innerHTML` fails
 * fast instead of silently introducing XSS.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Input from '@/components/atoms/Input.vue';

const XSS_PAYLOAD = "<script>alert('xss')</script>";

describe('RISK-W01 — XSS payload renders as literal text', () => {
  it('Input.vue renders <script> payload as plain text in the label', () => {
    const wrapper = mount(Input, {
      props: { label: XSS_PAYLOAD, modelValue: '' },
    });

    // No real <script> element should be created from the payload
    expect(wrapper.findAll('script')).toHaveLength(0);

    // The literal string must be present as text content
    expect(wrapper.text()).toContain(XSS_PAYLOAD);
  });

  it('Input.vue renders <script> payload as plain text in the error message', () => {
    const wrapper = mount(Input, {
      props: { modelValue: '', error: XSS_PAYLOAD, id: 'test' },
    });

    expect(wrapper.findAll('script')).toHaveLength(0);
    expect(wrapper.text()).toContain(XSS_PAYLOAD);
  });

  it('Input.vue preserves <script> payload as the input value attribute (no DOM injection)', () => {
    const wrapper = mount(Input, {
      props: { modelValue: XSS_PAYLOAD },
    });

    // The payload must not introduce a <script> element into the DOM
    expect(wrapper.findAll('script')).toHaveLength(0);

    // The literal string is preserved verbatim as the input value attribute
    // (attribute binding escapes &, <, > — it does NOT parse HTML)
    const input = wrapper.find('input');
    expect(input.element.value).toBe(XSS_PAYLOAD);
  });

  it('Input.vue escapes other XSS vectors (img onerror, svg onload)', () => {
    const payload = '<img src=x onerror=alert(1)><svg onload=alert(1)>';
    const wrapper = mount(Input, {
      props: { label: payload, modelValue: '' },
    });

    // No executable <img onerror> or <svg onload> element injected
    expect(wrapper.findAll('img[onerror]')).toHaveLength(0);
    expect(wrapper.findAll('svg[onload]')).toHaveLength(0);

    // And the literal payload is present as text
    expect(wrapper.text()).toContain(payload);
  });
});
