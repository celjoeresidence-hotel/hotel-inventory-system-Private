import React, { type InputHTMLAttributes, forwardRef } from 'react';

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = '', label, id, indeterminate, ...props }, ref) => {
    const inputId = id || props.name || Math.random().toString(36).substr(2, 9);
    
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <input
          type="checkbox"
          id={inputId}
          ref={(el) => {
            if (el) {
              el.indeterminate = !!indeterminate;
            }
            if (typeof ref === 'function') {
              ref(el);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
            }
          }}
          className="w-4 h-4 text-[#2e7d32] bg-white border-gray-300 rounded focus:ring-[#2e7d32] focus:ring-2 cursor-pointer accent-[#2e7d32]"
          {...props}
        />
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700 cursor-pointer select-none">
            {label}
          </label>
        )}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
