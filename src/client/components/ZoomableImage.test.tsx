import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HotkeysProvider, useHotkeys } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';

import { ZoomableImage } from './ZoomableImage';

const IMAGE_SRC = '/images/diagram.png';

const renderImage = () => render(<ZoomableImage src={IMAGE_SRC} alt="diagram" />);

describe('ZoomableImage', () => {
  it('opens the image in a lightbox when clicked', async () => {
    const user = userEvent.setup();
    renderImage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('img', { name: 'diagram' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: 'diagram' })).toHaveAttribute('src', IMAGE_SRC);
    expect(dialog.parentElement).toBe(document.body);
  });

  it('opens the lightbox with the Enter key', async () => {
    const user = userEvent.setup();
    renderImage();

    screen.getByRole('img', { name: 'diagram' }).focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the lightbox with the Escape key', async () => {
    const user = userEvent.setup();
    renderImage();

    await user.click(screen.getByRole('img', { name: 'diagram' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the lightbox when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    renderImage();

    await user.click(screen.getByRole('img', { name: 'diagram' }));
    await user.click(screen.getByRole('dialog'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the lightbox with the close button', async () => {
    const user = userEvent.setup();
    renderImage();

    await user.click(screen.getByRole('img', { name: 'diagram' }));
    await user.click(screen.getByRole('button', { name: 'Close image preview' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open the lightbox for an image inside a link', async () => {
    const user = userEvent.setup();
    render(
      <a href="#badge">
        <ZoomableImage src={IMAGE_SRC} alt="badge" />
      </a>,
    );

    await user.click(screen.getByRole('img', { name: 'badge' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps clicks on the image and the lightbox from reaching parent handlers', async () => {
    const user = userEvent.setup();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <ZoomableImage src={IMAGE_SRC} alt="diagram" />
      </div>,
    );

    await user.click(screen.getByRole('img', { name: 'diagram' }));
    await user.click(screen.getByRole('dialog'));

    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('suspends the active hotkey scopes while the lightbox is open', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    function NavigationHotkey() {
      useHotkeys('j', onNavigate, { scopes: 'navigation' });
      return null;
    }
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <NavigationHotkey />
        <ZoomableImage src={IMAGE_SRC} alt="diagram" />
      </HotkeysProvider>,
    );

    await user.click(screen.getByRole('img', { name: 'diagram' }));
    await user.keyboard('j');
    expect(onNavigate).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await user.keyboard('j');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
