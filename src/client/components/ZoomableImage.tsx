import { X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

interface ImageLightboxProps {
  src: string;
  alt: string;
  style?: CSSProperties;
  onClose: () => void;
}

function ImageLightbox({ src, alt, style, onClose }: ImageLightboxProps) {
  const { activeScopes, enableScope, disableScope } = useHotkeysContext();
  const [suspendedScopes] = useState(activeScopes);

  useHotkeys('escape', () => onClose(), [onClose]);

  useEffect(() => {
    suspendedScopes.forEach(disableScope);
    return () => suspendedScopes.forEach(enableScope);
  }, [suspendedScopes, enableScope, disableScope]);

  // React bubbles events from a portal through its React ancestors, such as a clickable comment card.
  const handleClick = (event: MouseEvent) => {
    event.stopPropagation();
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image preview'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
      onClick={handleClick}
    >
      <button
        type="button"
        autoFocus
        className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        aria-label="Close image preview"
      >
        <X size={24} />
      </button>
      <img src={src} alt={alt} className="max-w-[95vw] max-h-[95vh] object-contain" style={style} />
    </div>,
    document.body,
  );
}

type ZoomableImageProps = Omit<
  ComponentPropsWithoutRef<'img'>,
  'onClick' | 'onKeyDown' | 'tabIndex'
> & {
  src: string;
  lightboxStyle?: CSSProperties;
};

const isInsideLink = (element: HTMLElement) => element.closest('a') !== null;

export function ZoomableImage({
  src,
  alt = '',
  className = '',
  lightboxStyle,
  ...imgProps
}: ZoomableImageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const open = (event: MouseEvent<HTMLImageElement> | KeyboardEvent<HTMLImageElement>) => {
    if (isInsideLink(event.currentTarget)) return;
    event.preventDefault();
    event.stopPropagation();
    setIsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      open(event);
    }
  };

  const close = () => {
    setIsOpen(false);
    imageRef.current?.focus();
  };

  return (
    <>
      <img
        {...imgProps}
        ref={imageRef}
        src={src}
        alt={alt}
        tabIndex={0}
        className={`cursor-zoom-in [a_&]:cursor-pointer ${className}`}
        onClick={open}
        onKeyDown={handleKeyDown}
      />
      {isOpen && <ImageLightbox src={src} alt={alt} style={lightboxStyle} onClose={close} />}
    </>
  );
}
