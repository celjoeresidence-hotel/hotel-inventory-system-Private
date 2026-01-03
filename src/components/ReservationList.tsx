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
import { IconCheckCircle, IconX, IconLoader, IconPlus } from './ui/Icons';
import { ConfirmationModal } from './ConfirmationModal';
import CreateReservationModal from './CreateReservationModal';
import { convertReservationToStay } from '../utils/reservationUtils';

export default function ReservationList() {
  const { session } = useAuth();
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'pending' | 'history'>('upcoming');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Approval Modal State
  const [confirmingApproval, setConfirmingApproval] = useState<{id: string, data: any} | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const client = supabase;
      if (!client) return;

      let query = client
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
    const checkIn = r.data.check_in_date;
    const today = new Date().toISOString().split('T')[0];

    if (activeTab === 'pending') {
        return status === 'pending';
    } else if (activeTab === 'upcoming') {
        // Approved and future/today (not converted/cancelled)
        return status === 'approved' && checkIn >= today;
    } else {
        // History: Converted, Cancelled, Expired, Past
        return ['converted', 'cancelled', 'expired'].includes(status) || (status === 'approved' && checkIn < today);
    }
  });

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
                            In: {r.data.check_in_date}<br/>
                            Out: {r.data.check_out_date}
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
                        <Badge variant={
                            r.status === 'approved' ? 'success' : 
                            r.status === 'pending' ? 'warning' : 
                            r.status === 'converted' ? 'default' : 'error'
                        }>
                            {r.status}
                        </Badge>
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

                            {r.status === 'approved' && (
                                <>
                                    <Button 
                                        size="sm" 
                                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 h-auto"
                                        onClick={() => handleConvert(r)}
                                        disabled={!!actionLoading}
                                    >
                                        Check In
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
    </div>
  );
}
