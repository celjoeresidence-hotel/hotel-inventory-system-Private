import React, { type HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'outline';
  size?: 'default' | 'sm';
  children: React.ReactNode;
}

export const Badge = ({ variant = 'default', size = 'default', className = '', children, ...props }: BadgeProps) => {
  const sizeClasses = size === 'sm' ? 'px-1.5 py-0 text-[10px]' : '';
  
  return (
    <span className={`ui-badge ui-badge-${variant} ${sizeClasses} ${className}`} {...props}>
      {children}
    </span>
  );
};
