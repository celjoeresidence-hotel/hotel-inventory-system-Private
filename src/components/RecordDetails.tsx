import React from 'react';

export interface OperationalRecordRow {
  id: string;
  entity_type: string;
  status: string;
  data: any | null;
  created_at: string | null;
  original_id?: string | null;
  submitted_by?: string | null;
}

const DetailRow = ({ label, value }: { label: string, value: any }) => (
  <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
    <span className="text-gray-500 font-medium">{label}</span>
    <span className="text-gray-900 text-right max-w-[60%] break-words">{value ?? '—'}</span>
  </div>
);

const Section = ({ title, children }: { title: string, children: React.ReactNode }) => (
  <div className="mb-6 last:mb-0">
    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{title}</h4>
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
      {children}
    </div>
  </div>
);

export function RecordDetails({ record }: { record: OperationalRecordRow }) {
  const d: any = record.data ?? {};
  const type = record.entity_type;

  if (type === 'front_desk') {
    // Resolve room identity for display
    const roomId = d?.stay?.room_id || d?.room_id;
    const roomNumber = d?.stay?.room_number || d?.room_number;
    const displayRoom = roomNumber ? roomNumber : undefined;
    return (
      <div className="space-y-1">
        <Section title="Guest Info">
          <DetailRow label="Full Name" value={d?.guest?.full_name} />
          <DetailRow label="Phone" value={d?.guest?.phone} />
          <DetailRow label="Email" value={d?.guest?.email} />
          <DetailRow label="ID Ref" value={d?.guest?.id_reference} />
        </Section>
        <Section title="Stay Info">
          <DetailRow label="Room" value={displayRoom ?? (roomId ? 'Unknown Room' : '—')} />
          <DetailRow label="Check-in" value={d?.stay?.check_in} />
          <DetailRow label="Check-out" value={d?.stay?.check_out} />
          <DetailRow label="Adults" value={d?.stay?.adults} />
          <DetailRow label="Children" value={d?.stay?.children} />
        </Section>
        {d?.meta?.notes && (
          <Section title="Notes">
            <div className="text-gray-700 whitespace-pre-wrap text-sm">{d.meta.notes}</div>
          </Section>
        )}
      </div>
    );
  }

  if (type === 'kitchen' || type === 'bar') {
    return (
      <div className="space-y-1">
        <Section title="Stock Details">
          <DetailRow label="Date" value={d?.date} />
          <DetailRow label="Item" value={d?.item_name} />
          <DetailRow label="Opening Stock" value={d?.opening_stock} />
          <DetailRow label="Restocked" value={d?.restocked} />
          <DetailRow label="Sold" value={d?.sold} />
          <DetailRow label="Closing Stock" value={d?.closing_stock} />
          <DetailRow label="Unit Price" value={d?.unit_price} />
          <DetailRow label="Total Amount" value={d?.total_amount} />
        </Section>
        {d?.notes && (
          <Section title="Notes">
            <div className="text-gray-700 whitespace-pre-wrap text-sm">{d.notes}</div>
          </Section>
        )}
      </div>
    );
  }

  if (type === 'storekeeper') {
    return (
      <div className="space-y-1">
        <Section title="Stock Details">
          <DetailRow label="Date" value={d?.date} />
          <DetailRow label="Item" value={d?.item_name} />
          <DetailRow label="Opening Stock" value={d?.opening_stock} />
          <DetailRow label="Restocked" value={d?.restocked} />
          <DetailRow label="Issued" value={d?.issued} />
          <DetailRow label="Closing Stock" value={d?.closing_stock} />
        </Section>
        {d?.notes && (
          <Section title="Notes">
            <div className="text-gray-700 whitespace-pre-wrap text-sm">{d.notes}</div>
          </Section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Raw Data">
        <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono bg-white p-2 rounded border border-gray-200">
          {JSON.stringify(d ?? {}, null, 2)}
        </pre>
      </Section>
    </div>
  );
}
