import { type SelectHTMLAttributes, forwardRef, useId } from 'react';
import { IconChevronDown } from './Icons';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', label, error, helperText, fullWidth = true, children, options, placeholder, disabled, ...props }, ref) => {
    const reactId = useId();
    const inputId = props.id || props.name || reactId;
    
    return (
      <div className={`ui-input-wrapper ${fullWidth ? 'w-full' : 'w-auto'} ${className}`}>
        {label && (
          <label htmlFor={inputId} className="ui-label">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            id={inputId}
            ref={ref}
            disabled={disabled}
            className={`ui-input appearance-none pr-8 ${error ? 'ui-input-error' : ''}`}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            )) : children}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
            <IconChevronDown className="h-4 w-4" />
          </div>
        </div>
        {error && <p className="ui-error-text">{error}</p>}
        {helperText && !error && <p className="ui-helper-text">{helperText}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
