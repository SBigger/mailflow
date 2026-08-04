/**
 * Minimaler Button — bewusst ohne Radix und class-variance-authority.
 * Die App soll wenige Abhängigkeiten haben; für die Triage-Oberfläche
 * reichen drei Varianten.
 */
import React from 'react';

const VARIANTEN = {
  default: 'bg-slate-900 text-white hover:bg-slate-800',
  outline: 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-900',
  ghost:   'hover:bg-slate-100 text-slate-700',
};

const GROESSEN = {
  default: 'h-9 px-4 text-sm',
  sm:      'h-7 px-2 text-xs',
};

export function Button({ variant = 'default', size = 'default', className = '', ...props }) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium',
        'transition-colors disabled:pointer-events-none disabled:opacity-50',
        VARIANTEN[variant] ?? VARIANTEN.default,
        GROESSEN[size] ?? GROESSEN.default,
        className,
      ].join(' ')}
      {...props}
    />
  );
}

export default Button;
