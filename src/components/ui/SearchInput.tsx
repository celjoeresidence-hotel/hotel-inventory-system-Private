import { IconSearch, IconXCircle } from './Icons';
import { Input } from './Input';

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChangeValue: (val: string) => void;
  onClear?: () => void;
  fullWidth?: boolean;
}

export function SearchInput({ value, onChangeValue, onClear, className, fullWidth, ...props }: SearchInputProps) {
  return (
    <div className={`relative ${fullWidth ? 'w-full' : ''} ${className || ''}`}>
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <IconSearch className="h-4 w-4 text-gray-400" />
      </div>
      <Input
        type="text"
        value={value}
        onChange={(e) => onChangeValue(e.target.value)}
        className="pl-10 pr-10"
        fullWidth={fullWidth}
        {...props}
      />
      {value && (
        <button
          onClick={() => {
            onChangeValue('');
            if (onClear) onClear();
          }}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
        >
          <IconXCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
