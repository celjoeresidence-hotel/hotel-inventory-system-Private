type UIItem = {
  item_name: string;
  unit: string | null;
  unit_price: number | null;
  opening_stock: number | null;
};

interface Props {
  items: UIItem[];
  restockedMap: Record<string, number>;
  soldMap: Record<string, number>;
  disabled?: boolean;
  onChangeRestocked: (name: string, value: number) => void;
  onChangeSold: (name: string, value: number) => void;
}

export default function InventoryConsumptionTable({
  items,
  restockedMap,
  soldMap,
  disabled = false,
  onChangeRestocked,
  onChangeSold,
}: Props) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Item</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Unit</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Opening Stock</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Quantity Re-Stock</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Quantity Sold</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Closing Stock</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Unit Price</th>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Total Sales</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => {
            const o = Number(row.opening_stock ?? 0);
            const r = Number(restockedMap[row.item_name] ?? 0);
            const s = Number(soldMap[row.item_name] ?? 0);
            const uRaw = row.unit_price; // may be null
            const closing = o + r - s;
            const totalRaw = typeof uRaw === 'number' && Number.isFinite(uRaw) ? s * uRaw : null;
            return (
              <tr key={row.item_name}>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px' }}>{row.item_name}</td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px' }}>{row.unit ?? '—'}</td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{Number.isFinite(o) ? o : '—'}</td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={r}
                    onChange={(e) => onChangeRestocked(row.item_name, Number(e.target.value))}
                    disabled={disabled}
                    style={{ width: 120 }}
                  />
                </td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={s}
                    onChange={(e) => onChangeSold(row.item_name, Number(e.target.value))}
                    disabled={disabled}
                    style={{ width: 120 }}
                  />
                </td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{closing}</td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{typeof uRaw === 'number' && Number.isFinite(uRaw) ? uRaw.toFixed(2) : '—'}</td>
                <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{typeof totalRaw === 'number' ? totalRaw.toFixed(2) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}