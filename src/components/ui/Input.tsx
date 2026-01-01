import { type InputHTMLAttributes, forwardRef } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, helperText, fullWidth, id, ...props }, ref) => {
    const inputId = id || props.name || Math.random().toString(36).substr(2, 9);
    
    return (
      <div className={`ui-input-wrapper ${fullWidth ? 'w-full' : ''} ${className}`}>
        {label && (
          <label htmlFor={inputId} className="ui-label">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={`ui-input ${error ? 'ui-input-error' : ''}`}
          {...props}
        />
        {error && <p className="ui-error-text">{error}</p>}
        {helperText && !error && <p className="ui-helper-text">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
