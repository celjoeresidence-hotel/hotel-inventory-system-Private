import { Input } from './ui/Input';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from './ui/Table';

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
  notesMap?: Record<string, string>;
  disabled?: boolean;
  soldLabel?: string;
  onChangeRestocked: (name: string, value: number) => void;
  onChangeSold: (name: string, value: number) => void;
  onChangeNotes?: (name: string, value: string) => void;
}

export default function InventoryConsumptionTable({
  items,
  restockedMap,
  soldMap,
  notesMap,
  disabled = false,
  soldLabel = 'Sold',


  onChangeRestocked,
  onChangeSold,
  onChangeNotes,
}: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300 animate-in fade-in">
        <p className="text-gray-500 font-medium">No items found in this category.</p>
        <p className="text-gray-400 text-sm mt-1">Select a different category or contact an admin.</p>
      </div>
    );
  }

  const showNotes = !!notesMap && !!onChangeNotes;

  return (
    <div className="overflow-x-auto border rounded-lg shadow-sm bg-white">
      <Table>
        <TableHeader className="bg-gray-50">
          <TableRow>
            <TableHead className="w-[180px] sticky left-0 bg-gray-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Item</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Opening</TableHead>
            <TableHead className="text-right min-w-[100px]">Re-Stock</TableHead>
            <TableHead className="text-right min-w-[100px]">{soldLabel}</TableHead>
            <TableHead className="text-right">Closing</TableHead>
            <TableHead className="text-right hidden md:table-cell">Price</TableHead>
            <TableHead className="text-right hidden md:table-cell">Total</TableHead>
            {showNotes && <TableHead className="min-w-[150px]">Notes</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => {
            const o = Number(row.opening_stock ?? 0);
            const r = Number(restockedMap[row.item_name] ?? 0);
            const s = Number(soldMap[row.item_name] ?? 0);
            const n = notesMap ? (notesMap[row.item_name] ?? '') : '';
            const uRaw = row.unit_price; // may be null
            const closing = o + r - s;
            const totalRaw = typeof uRaw === 'number' && Number.isFinite(uRaw) ? s * uRaw : null;
            
            // Highlight row if there is activity
            const hasActivity = r > 0 || s > 0 || n.length > 0;
            const rowClass = hasActivity ? 'bg-green-50/50' : 'hover:bg-gray-50';
            // We need to manually handle the sticky background because 'tr' background doesn't apply to sticky 'td' in some browsers/contexts properly if not explicit
            const stickyBgClass = hasActivity ? 'bg-green-50' : 'bg-white group-hover:bg-gray-50';

            return (
              <TableRow key={row.item_name} className={`transition-colors group ${rowClass}`}>
                <TableCell className={`font-medium text-gray-900 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${stickyBgClass}`}>
                  {row.item_name}
                </TableCell>
                <TableCell className="text-gray-500">{row.unit ?? '—'}</TableCell>
                <TableCell className="text-right font-mono text-gray-600">{Number.isFinite(o) ? o : '—'}</TableCell>
                <TableCell className="text-right p-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={r === 0 ? '' : r}
                    onChange={(e) => onChangeRestocked(row.item_name, e.target.value === '' ? 0 : Number(e.target.value))}
                    disabled={disabled}
                    className="text-right h-9 text-sm w-24 ml-auto"
                    placeholder="0"
                  />
                </TableCell>
                <TableCell className="text-right p-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={s === 0 ? '' : s}
                    onChange={(e) => onChangeSold(row.item_name, e.target.value === '' ? 0 : Number(e.target.value))}
                    disabled={disabled}
                    className="text-right h-9 text-sm w-24 ml-auto"
                    placeholder="0"
                  />
                </TableCell>
                <TableCell className={`text-right font-mono font-medium ${closing < 0 ? 'text-error' : 'text-gray-900'}`}>
                  {Number.isFinite(closing) ? closing : '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-gray-900 hidden md:table-cell">
                  {typeof uRaw === 'number' && Number.isFinite(uRaw) ? uRaw.toFixed(2) : '—'}
                </TableCell>
                <TableCell className="text-right font-medium text-gray-900 hidden md:table-cell">
                  {typeof totalRaw === 'number' ? totalRaw.toFixed(2) : '—'}
                </TableCell>
                {showNotes && (
                  <TableCell className="p-2">
                    <input
                      type="text"
                      value={n}
                      onChange={(e) => onChangeNotes && onChangeNotes(row.item_name, e.target.value)}
                      disabled={disabled}
                      placeholder="..."
                      className="w-full h-9 px-2 py-1 text-sm rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all bg-white"
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
