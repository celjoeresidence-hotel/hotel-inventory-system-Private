import { type ButtonHTMLAttributes, forwardRef } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    
    return (
      <button
        ref={ref}
        className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ui-spinner-sm" />
            {children}
          </span>
        ) : children}
      </button>
    );
  }
);

Button.displayName = "Button";
