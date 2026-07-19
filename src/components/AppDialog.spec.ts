import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppDialog from './AppDialog.vue';

describe('AppDialog', () => {
  it('renders an accessible dialog with a custom width token', () => {
    const wrapper = mount(AppDialog, {
      props: {
        open: true,
        ariaLabel: 'Connection',
        width: '760px',
      },
      slots: {
        default: '<button type="button">Save</button>',
      },
    });

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Connection');
    expect(wrapper.get('.app-dialog-layer').attributes('style')).toContain(
      '--app-dialog-width: 760px',
    );
    expect(wrapper.text()).toContain('Save');
  });

  it('emits close when the backdrop is clicked', async () => {
    const wrapper = mount(AppDialog, {
      props: {
        open: true,
        ariaLabel: 'Connection',
      },
    });

    await wrapper.get('.app-dialog-layer').trigger('mousedown');

    expect(wrapper.emitted('close')).toEqual([[]]);
  });
});
