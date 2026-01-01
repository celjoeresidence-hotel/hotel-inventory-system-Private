import { Button } from './Button';
import { IconChevronLeft, IconChevronRight } from './Icons';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ currentPage, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  // Calculate visible page range (e.g. 1 2 3 ... 10)
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 3; i++) pages.push(i);
        pages.push(-1); // ellipsis
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push(-1);
        for (let i = totalPages - 2; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push(-1);
        pages.push(currentPage);
        pages.push(-1);
        pages.push(totalPages);
      }
    }
    return pages;
  };

  return (
    <div className={`flex items-center justify-center gap-2 py-4 ${className || ''}`}>
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="w-9 h-9 p-0"
      >
        <IconChevronLeft className="w-4 h-4" />
      </Button>
      
      {getPageNumbers().map((p, idx) => (
        p === -1 ? (
          <span key={`sep-${idx}`} className="text-gray-400 px-2">...</span>
        ) : (
          <Button
            key={p}
            variant={currentPage === p ? 'primary' : 'outline'}
            size="sm"
            onClick={() => onPageChange(p)}
            className={`w-9 h-9 p-0 ${currentPage === p ? 'ring-2 ring-offset-1 ring-green-500' : ''}`}
          >
            {p}
          </Button>
        )
      ))}

      <Button
        variant="outline"
        size="sm"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="w-9 h-9 p-0"
      >
        <IconChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}
