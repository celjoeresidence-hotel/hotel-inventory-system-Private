import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  itemName?: string;
  loading?: boolean;
}

export const DeleteConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Deletion',
  message = 'Are you sure you want to delete this item? This action cannot be undone.',
  itemName,
  loading = false,
}: DeleteConfirmationModalProps) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading} isLoading={loading}>
            Delete
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-gray-600">{message}</p>
        {itemName && (
          <p className="font-medium text-gray-900 bg-red-50 p-2 rounded border border-red-100">
            {itemName}
          </p>
        )}
      </div>
    </Modal>
  );
};
