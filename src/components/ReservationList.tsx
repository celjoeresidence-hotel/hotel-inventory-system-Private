import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableHead, 
  TableRow, 
  TableCell 
} from './ui/Table';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { IconCheckCircle, IconX, IconLoader, IconPlus, IconTrash2 } from './ui/Icons';
import { ConfirmationModal } from './ConfirmationModal';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';
import CreateReservationModal from './CreateReservationModal';
import { convertReservationToStay } from '../utils/reservationUtils';

export default function ReservationList() {
  const { session } = useAuth();
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'pending' | 'missed' | 'history'>('upcoming');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editStartTime, setEditStartTime] = useState('14:00');
  const [editEndTime, setEditEndTime] = useState('11:00');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Approval Modal State
  const [confirmingApproval, setConfirmingApproval] = useState<{id: string, data: any} | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const client = supabase;
      if (!client) return;

      const query = client
        .from('operational_records')
        .select('*')
        .eq('entity_type', 'front_desk')
        .filter('data->>type', 'eq', 'room_reservation')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      setReservations(data || []);
    } catch (err) {
      console.error('Error fetching reservations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReservations();
  }, []);

  const handleApproveClick = (id: string, currentData: any) => {
    setConfirmingApproval({ id, data: currentData });
  };

  const executeApproval = async () => {
    if (!confirmingApproval || !supabase) return;

    setIsApproving(true);
    try {
        const { error } = await supabase.rpc('approve_record', { 
            _id: confirmingApproval.id 
        });

        if (error) throw error;
        
        fetchReservations();
        setConfirmingApproval(null);
    } catch (err: any) {
        console.error('Error approving:', err);
        alert(`Error approving reservation: ${err.message || err.error_description || 'Unknown error'}`);
    } finally {
        setIsApproving(false);
    }
  };

  const handleCancel = async (id: string, currentData: any) => {
    const reason = prompt('Reason for cancellation (required):');
    if (!reason) return;
    if (!supabase) return;

    setActionLoading(id);
    try {
        const { error } = await supabase
            .from('operational_records')
            .update({ 
                status: 'cancelled',
                data: { 
                    ...currentData, 
                    status: 'cancelled', 
                    cancellation_reason: reason,
                    cancelled_by: session?.user?.id 
                }
            })
            .eq('id', id);
        if (error) throw error;
        fetchReservations();
    } catch (err) {
        alert('Error cancelling reservation');
    } finally {
        setActionLoading(null);
    }
  };

  const handleMarkNoShow = async (id: string, currentData: any) => {
    if (!confirm('Mark this reservation as No Show?')) return;
    if (!supabase) return;

    setActionLoading(id);
    try {
        const { error } = await supabase
            .from('operational_records')
            .update({ 
                status: 'expired', // Using expired for No Show to distinguish from explicit cancel
                data: { 
                    ...currentData, 
                    status: 'no_show', // Logic status
                    expired_reason: 'No Show',
                    expired_by: session?.user?.id 
                }
            })
            .eq('id', id);
        if (error) throw error;
        fetchReservations();
    } catch (err) {
        alert('Error marking no show');
    } finally {
        setActionLoading(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
  };

  const confirmDelete = async () => {
    if (!deletingId || !supabase) return;
    setActionLoading(deletingId);
    try {
      const { error } = await supabase.rpc('delete_record', { _id: deletingId });
      if (error) throw error;
      setDeletingId(null);
      fetchReservations();
    } catch (err: any) {
      alert(err.message || 'Failed to delete reservation. Note: Only Admins/Managers can delete records.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleConvert = async (reservation: any) => {
    if (!confirm('Convert this reservation to a Check-In? This will start the stay.')) return;
    if (!supabase) return;

    setActionLoading(reservation.id);
    try {
        await convertReservationToStay(supabase, reservation, session?.user?.id || '');
        fetchReservations();
    } catch (err: any) {
        console.error(err);
        alert(`Error converting reservation: ${err.message}`);
    } finally {
        setActionLoading(null);
    }
  };

  const filteredReservations = reservations.filter(r => {
    const status = r.status;
    const now = new Date();
    const nowStr = `${now.toISOString().split('T')[0]}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    const start = `${r.data.check_in_date}T${(r.data.start_time || '14:00')}:00`;
    const end = `${r.data.check_out_date}T${(r.data.end_time || '11:00')}:00`;

    if (activeTab === 'pending') {
        return status === 'pending';
    } else if (activeTab === 'upcoming') {
        return status === 'approved' && start >= nowStr && r.data?.status !== 'converted' && r.data?.reservation_status !== 'checked_in';
    } else if (activeTab === 'missed') {
        const isPastApprovedByTime = status === 'approved' && end < nowStr && r.data?.reservation_status !== 'checked_in';
        const isExplicitNoShow = status === 'expired' && r.data.status === 'no_show';
        return isPastApprovedByTime || isExplicitNoShow;
    } else {
        // History: Cancelled, Expired (other than no_show)
        const isExplicitNoShow = status === 'expired' && r.data.status === 'no_show';
        if (isExplicitNoShow) return false; // Handled in missed tab
        // Exclude converted reservations entirely from the reservations list
        return ['cancelled', 'expired'].includes(status);
    }
  });
  
  const saveEditTimes = async () => {
    if (!editing || !supabase) return;
    setActionLoading(editing.id);
    try {
      const { error } = await supabase
        .from('operational_records')
        .update({
          data: {
            ...editing.data,
            start_time: editStartTime,
            end_time: editEndTime
          }
        })
        .eq('id', editing.id);
      if (error) throw error;
      setEditing(null);
      fetchReservations();
    } catch (err: any) {
      alert(err.message || 'Error saving times');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-bold text-gray-900">Reservations</h2>
        <Button onClick={() => setIsCreateModalOpen(true)} className="bg-green-600 hover:bg-green-700 text-white">
            <IconPlus className="w-4 h-4 mr-2" />
            New Reservation
        </Button>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          className={`py-2 px-4 font-medium text-sm ${activeTab === 'upcoming' ? 'border-b-2 border-green-500 text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('upcoming')}
        >
          Upcoming
        </button>
        <button
          className={`py-2 px-4 font-medium text-sm ${activeTab === 'pending' ? 'border-b-2 border-green-500 text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('pending')}
        >
          Pending Approval
          {reservations.filter(r => r.status === 'pending').length > 0 && (
            <span className="ml-2 bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded-full">
                {reservations.filter(r => r.status === 'pending').length}
            </span>
          )}
        </button>
        <button
          className={`py-2 px-4 font-medium text-sm ${activeTab === 'missed' ? 'border-b-2 border-green-500 text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('missed')}
        >
          Missed / No Show
          {reservations.filter(r => {
             const status = r.status;
             const checkIn = r.data.check_in_date;
             const today = new Date().toISOString().split('T')[0];
             const isPastApproved = status === 'approved' && checkIn < today;
             const isExplicitNoShow = status === 'expired' && r.data.status === 'no_show';
             return isPastApproved || isExplicitNoShow;
          }).length > 0 && (
            <span className="ml-2 bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded-full">
                {reservations.filter(r => {
                    const status = r.status;
                    const checkIn = r.data.check_in_date;
                    const today = new Date().toISOString().split('T')[0];
                    const isPastApproved = status === 'approved' && checkIn < today;
                    const isExplicitNoShow = status === 'expired' && r.data.status === 'no_show';
                    return isPastApproved || isExplicitNoShow;
                }).length}
            </span>
          )}
        </button>
        <button
          className={`py-2 px-4 font-medium text-sm ${activeTab === 'history' ? 'border-b-2 border-green-500 text-green-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
      </div>

      <div className="bg-white border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Guest</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Deposit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
                <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        <IconLoader className="animate-spin w-6 h-6 mx-auto mb-2" />
                        Loading reservations...
                    </TableCell>
                </TableRow>
            ) : filteredReservations.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        No {activeTab} reservations found.
                    </TableCell>
                </TableRow>
            ) : (
                filteredReservations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.data.reservation_code}</TableCell>
                    <TableCell>
                        <div className="font-medium">{r.data.guest.name}</div>
                        <div className="text-xs text-gray-500">{r.data.guest.phone}</div>
                    </TableCell>
                    <TableCell>
                        {r.data.room_number} <span className="text-xs text-gray-400">({r.data.room_type})</span>
                    </TableCell>
                    <TableCell>
                        <div className="text-sm">
                            In: {r.data.check_in_date} {r.data.start_time || '14:00'}<br/>
                            Out: {r.data.check_out_date} {r.data.end_time || '11:00'}
                        </div>
                    </TableCell>
                    <TableCell>
                        {r.data.deposit_amount > 0 ? (
                            <span className="text-green-600 font-medium">₦{r.data.deposit_amount.toLocaleString()}</span>
                        ) : (
                            <span className="text-gray-400">-</span>
                        )}
                    </TableCell>
                    <TableCell>
                        {(() => {
                          const now = new Date();
                          const nowStr = `${now.toISOString().split('T')[0]}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
                          const start = `${r.data.check_in_date}T${(r.data.start_time || '14:00')}:00`;
                          const end = `${r.data.check_out_date}T${(r.data.end_time || '11:00')}:00`;
                          const isReserved = r.status === 'approved' && start <= nowStr && end > nowStr && r.data?.reservation_status !== 'checked_in';
                          const isMissed = r.status === 'approved' && end <= nowStr && r.data?.reservation_status !== 'checked_in';
                          const label = r.data.status === 'no_show' ? 'No Show' : isReserved ? 'reserved' : isMissed ? 'missed' : r.status;
                          const variant = label === 'reserved' ? 'warning' : label === 'missed' ? 'error' : (
                            r.status === 'approved' ? 'success' : 
                            r.status === 'pending' ? 'warning' : 
                            r.status === 'converted' ? 'default' : 
                            'error'
                          );
                          return <Badge variant={variant}>{label}</Badge>;
                        })()}
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2">
                            {r.status === 'pending' && (
                                <>
                                    <Button 
                                        size="sm" 
                                        className="bg-green-600 hover:bg-green-700 text-white h-8 w-8 p-0 rounded-full"
                                        onClick={() => handleApproveClick(r.id, r.data)}
                                        disabled={!!actionLoading}
                                        title="Approve"
                                    >
                                        <IconCheckCircle size={16} />
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant="outline"
                                        className="text-red-600 hover:bg-red-50 border-red-200 h-8 w-8 p-0 rounded-full"
                                        onClick={() => handleCancel(r.id, r.data)}
                                        disabled={!!actionLoading}
                                        title="Reject"
                                    >
                                        <IconX size={16} />
                                    </Button>
                                </>
                            )}

                            {r.status === 'approved' && activeTab === 'upcoming' && (
                                <>
                                    <Button 
                                        size="sm" 
                                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 h-auto"
                                        onClick={() => handleConvert(r)}
                                        disabled={!!actionLoading || `${r.data.check_in_date}T${(r.data.start_time || '14:00')}:00` > `${new Date().toISOString().split('T')[0]}T${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}:00`}
                                        title={`${r.data.check_in_date}T${(r.data.start_time || '14:00')}:00` > `${new Date().toISOString().split('T')[0]}T${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}:00` ? 'Check-in available when start time is reached' : undefined}
                                    >
                                        Check In
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-gray-700 hover:bg-gray-50 border-gray-200 text-xs px-2 py-1 h-auto"
                                      onClick={() => {
                                        setEditing(r);
                                        setEditStartTime(r.data.start_time || '14:00');
                                        setEditEndTime(r.data.end_time || '11:00');
                                      }}
                                    >
                                      Edit Time
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant="ghost"
                                        className="text-gray-700 hover:text-gray-900 h-8 w-8 p-0"
                                        onClick={() => handleDelete(r.id)}
                                        disabled={!!actionLoading}
                                        title="Delete Reservation"
                                    >
                                        <IconTrash2 size={16} />
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant="ghost"
                                        className="text-red-600 hover:text-red-800 h-8 w-8 p-0"
                                        onClick={() => handleCancel(r.id, r.data)}
                                        disabled={!!actionLoading}
                                        title="Cancel"
                                    >
                                        <IconX size={16} />
                                    </Button>
                                </>
                            )}
                            
                            {/* Actions for Missed Reservations */}
                            {activeTab === 'missed' && r.status === 'approved' && (
                                <>
                                    <Button 
                                        size="sm" 
                                        className="bg-red-600 hover:bg-red-700 text-white text-xs px-2 py-1 h-auto"
                                        onClick={() => handleMarkNoShow(r.id, r.data)}
                                        disabled={!!actionLoading}
                                    >
                                        Mark No Show
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant="outline"
                                        className="text-gray-600 hover:text-gray-800 h-8 w-8 p-0"
                                        onClick={() => handleConvert(r)} // Still allow check-in if late?
                                        disabled={!!actionLoading}
                                        title="Late Check In"
                                    >
                                        <IconCheckCircle size={16} />
                                    </Button>
                                </>
                            )}

                            {actionLoading === r.id && <IconLoader className="animate-spin w-4 h-4 text-gray-500" />}
                        </div>
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateReservationModal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)} 
        onSuccess={fetchReservations}
      />

      <ConfirmationModal
        isOpen={!!confirmingApproval}
        onClose={() => setConfirmingApproval(null)}
        onConfirm={executeApproval}
        title="Approve Reservation"
        message="Are you sure you want to approve this reservation? This will confirm the booking and update room availability."
        confirmLabel="Approve"
        confirmVariant="primary"
        loading={isApproving}
      />
      
      <DeleteConfirmationModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={confirmDelete}
        title="Delete Reservation"
        message="Are you sure you want to delete this reservation? This will remove it from lists. You can still view it under Risk analytics."
        itemName={reservations.find(r => r.id === deletingId)?.data?.reservation_code}
        loading={!!actionLoading}
      />
      
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Reservation Time</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  className="w-full border-gray-300 rounded-md shadow-sm focus:border-green-500 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="time"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  className="w-full border-gray-300 rounded-md shadow-sm focus:border-green-500 focus:ring-green-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveEditTimes} disabled={!!actionLoading} className="bg-green-600 hover:bg-green-700 text-white">
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
