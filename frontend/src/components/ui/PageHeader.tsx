import React from 'react';

/**
 * The top of every page: title, a one-line purpose, the page's own actions and, optionally, context underneath (status
 * pills, a disclosure). Rises in first, before the sections below it.
 */
export const PageHeader: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Small context above the title, such as an investigation reference. Not a decorative eyebrow. */
  context?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  titleClassName?: string;
}> = ({ title, description, actions, context, children, className = '', titleClassName = '' }) => (
  <header data-reveal className={`flex flex-col gap-4 md:flex-row md:items-end md:justify-between ${className}`}>
    <div className="min-w-0 max-w-3xl">
      {context && <div className="mb-1.5 text-[13px] text-mute">{context}</div>}
      <h1 className={`page-title ${titleClassName}`}>{title}</h1>
      {description && <p className="mt-2 lede max-w-[68ch]">{description}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </header>
);

/** A section heading inside a page. */
export const SectionHeader: React.FC<{
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  as?: 'h2' | 'h3';
}> = ({ id, title, description, aside, as: Tag = 'h2' }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0 max-w-3xl">
      <Tag id={id} className="section-title">
        {title}
      </Tag>
      {description && <p className="mt-1 text-sm leading-relaxed text-mute max-w-[72ch]">{description}</p>}
    </div>
    {aside}
  </div>
);
