import {forwardRef, type ComponentPropsWithoutRef} from 'react';

export type BookButtonVariant = 'action' | 'primary' | 'quiet' | 'tab' | 'choice' | 'icon';
export type BookButtonProps = ComponentPropsWithoutRef<'button'> & {variant?: BookButtonVariant};

/** Native semantics and refs are preserved; selection belongs to tab/choice only. */
export const BookButton = forwardRef<HTMLButtonElement, BookButtonProps>(function BookButton(
  {variant = 'action', className = '', type = 'button', ...props}, ref,
) {
  return <button {...props} ref={ref} type={type} className={`ui-control ${className}`.trim()} data-ui-variant={variant}/>;
});
