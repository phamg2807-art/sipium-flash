'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/format';

export function Button({
  variant = 'default',
  size,
  block,
  loading,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'lg' | 'icon';
  block?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'btn',
        variant !== 'default' && `btn--${variant}`,
        size && `btn--${size}`,
        block && 'btn--block',
        className,
      )}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  text,
  action,
  compact,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="empty" style={compact ? { padding: '28px 18px' } : undefined}>
      <p className="empty__title">{title}</p>
      {text ? <p className="empty__text">{text}</p> : null}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__item"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function Chip({
  children,
  tone,
  onClick,
  title,
}: {
  children: ReactNode;
  tone?: 'accent' | 'good' | 'warn' | 'bad';
  onClick?: () => void;
  title?: string;
}) {
  return (
    <span
      className={cx('chip', tone && `chip--${tone}`, onClick && 'chip--button')}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  children: ReactNode;
}) {
  return <div className={`banner banner--${tone}`}>{children}</div>;
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={cx('spinner', large && 'spinner--lg')} aria-label="Loading" />;
}
