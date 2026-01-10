import { useEffect, useState, useRef, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Checkbox } from './ui/Checkbox';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { SearchInput } from './ui/SearchInput';
import { Pagination } from './ui/Pagination';
import { 
  IconPlus, 
  IconEdit, 
  IconChevronRight,
  IconBox,
  IconCheckSquare,
  IconAlertCircle,
  IconCheckCircle,
  IconTrash2
} from './ui/Icons';

interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
  assigned_to?: string[];
  status?: 'approved' | 'pending' | 'rejected' | string;
}

interface CollectionRow {
  id: string;
  name: string;
  active?: boolean;
  status?: 'approved' | 'pending' | 'rejected' | string;
}

interface InventoryStructureTabProps {
  onStructureChange?: () => void;
}

export default function InventoryStructureTab({ onStructureChange }: InventoryStructureTabProps) {
  const { session, isConfigured, isSupervisor, isManager, isAdmin, role, ensureActiveSession } = useAuth();
  const canEditStructure = Boolean(isSupervisor || isManager || isAdmin || role === 'storekeeper');

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');
  const [categoriesReloadKey, setCategoriesReloadKey] = useState<number>(0);

  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [loadingCollections, setLoadingCollections] = useState<boolean>(false);
  const [collectionsReloadKey, setCollectionsReloadKey] = useState<number>(0);

  // Search & Pagination State
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryPage, setCategoryPage] = useState(1);
  const CATEGORY_PAGE_SIZE = 10;

  const [collectionSearch, setCollectionSearch] = useState('');
  const [collectionPage, setCollectionPage] = useState(1);
  const COLLECTION_PAGE_SIZE = 10;

  const filteredCategories = useMemo(() => {
    return categories.filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase()));
  }, [categories, categorySearch]);

  const paginatedCategories = useMemo(() => {
    const start = (categoryPage - 1) * CATEGORY_PAGE_SIZE;
    return filteredCategories.slice(start, start + CATEGORY_PAGE_SIZE);
  }, [filteredCategories, categoryPage]);

  const filteredCollections = useMemo(() => {
    return collections.filter(c => c.name.toLowerCase().includes(collectionSearch.toLowerCase()));
  }, [collections, collectionSearch]);

  const paginatedCollections = useMemo(() => {
    const start = (collectionPage - 1) * COLLECTION_PAGE_SIZE;
    return filteredCollections.slice(start, start + COLLECTION_PAGE_SIZE);
  }, [filteredCollections, collectionPage]);

  useEffect(() => setCategoryPage(1), [categorySearch]);
  useEffect(() => setCollectionPage(1), [collectionSearch]);

  // Add Category State
  const [addCategoryOpen, setAddCategoryOpen] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [savingCategory, setSavingCategory] = useState<boolean>(false);
  const [newCategoryAssignedKitchen, setNewCategoryAssignedKitchen] = useState<boolean>(false);
  const [newCategoryAssignedBar, setNewCategoryAssignedBar] = useState<boolean>(false);
  const [newCategoryAssignedStorekeeper, setNewCategoryAssignedStorekeeper] = useState<boolean>(false);

  // Add Collection State
  const [addCollectionOpen, setAddCollectionOpen] = useState<boolean>(false);
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [savingCollection, setSavingCollection] = useState<boolean>(false);

  // Edit Category Assignments State
  const [editCategoryOpen, setEditCategoryOpen] = useState<boolean>(false);
  const [editCategoryTarget, setEditCategoryTarget] = useState<CategoryRow | null>(null);
  const [editAssignedKitchen, setEditAssignedKitchen] = useState<boolean>(false);
  const [editAssignedBar, setEditAssignedBar] = useState<boolean>(false);
  const [editAssignedStorekeeper, setEditAssignedStorekeeper] = useState<boolean>(false);

  // Deletion State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'category' | 'collection', id: string, name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function promptDeleteCategory(cat: CategoryRow) {
    setDeleteTarget({ type: 'category', id: cat.id, name: cat.name });
    setDeleteConfirmOpen(true);
  }

  function promptDeleteCollection(col: CollectionRow) {
    setDeleteTarget({ type: 'collection', id: col.id, name: col.name });
    setDeleteConfirmOpen(true);
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setMessage(null);
    try {
        if (!supabase) throw new Error('Supabase client not initialized');
        const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
        if (!ok) {
            setError('Session expired. Please sign in again.');
            setIsDeleting(false);
            return;
        }

        if (deleteTarget.type === 'category') {
             const { error } = await supabase.rpc('delete_inventory_category', { _id: deleteTarget.id });
             if (error) throw error;
             setCategoriesReloadKey(k => k + 1);
             if (selectedCategoryName === deleteTarget.name) {
                setSelectedCategoryName('');
             }
        } else {
             const { error } = await supabase.rpc('delete_inventory_collection', { _id: deleteTarget.id });
             if (error) throw error;
             setCollectionsReloadKey(k => k + 1);
        }
        
        setMessage(`Successfully deleted ${deleteTarget.type} "${deleteTarget.name}"`);
        setTimeout(() => setMessage(null), 3000);
        
        setDeleteConfirmOpen(false);
        setDeleteTarget(null);
    } catch (e: any) {
        setError(e.message);
    } finally {
        setIsDeleting(false);
    }
  }
  // Mobile scroll ref
  const collectionsRef = useRef<HTMLButtonElement>(null);

  // Fetch Categories
  useEffect(() => {
    async function fetchCategories() {
      setError(null);
      setLoadingCategories(true);
      try {
        if (!isConfigured || !session || !supabase) return;
        const { data, error } = await supabase
          .from('inventory_categories')
          .select('*')
          .is('deleted_at', null)
          .order('name');
        
        if (error) {
          setError(error.message);
          return;
        }

        const list: CategoryRow[] = (data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          active: r.is_active,
          assigned_to: r.assigned_to || [],
          status: 'approved', // New tables are always authoritative/approved
        }));
        setCategories(list);
        if (!selectedCategoryName && list.length > 0) {
          setSelectedCategoryName(list[0].name);
        }
      } finally {
        setLoadingCategories(false);
      }
    }
    fetchCategories();
  }, [isConfigured, session, categoriesReloadKey]);

  useEffect(() => {
    async function fetchCollectionsForSelected() {
      setLoadingCollections(true);
      try {
        if (!isConfigured || !session || !supabase || !selectedCategoryName) {
            setCollections([]);
            return;
        }
        
        // First get the category ID
        const category = categories.find(c => c.name === selectedCategoryName);
        if (!category) {
            setCollections([]);
            return;
        }

        const { data, error } = await supabase
          .from('inventory_collections')
          .select('*')
          .eq('category_id', category.id)
          .is('deleted_at', null)
          .order('name');

        if (error) {
          setError(error.message);
          return;
        }

        const list = (data ?? []).map((r: any) => ({ 
            id: r.id, 
            name: r.name, 
            active: r.is_active, 
            status: 'approved' 
        }));
        setCollections(list);
      } finally {
        setLoadingCollections(false);
      }
    }
    fetchCollectionsForSelected();
  }, [selectedCategoryName, isConfigured, session, collectionsReloadKey, categories]);

  async function saveCategory() {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    const assigned: string[] = [];
    if (newCategoryAssignedKitchen) assigned.push('kitchen');
    if (newCategoryAssignedBar) assigned.push('bar');
    if (newCategoryAssignedStorekeeper) assigned.push('storekeeper');
    
    try {
        if (!supabase) throw new Error('Supabase client not initialized');
        const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
        if (!ok) {
            setError('Session expired. Please sign in again.');
            setSavingCategory(false);
            return;
        }

        // Check if active category exists
        const { data: existing } = await supabase
            .from('inventory_categories')
            .select('id')
            .eq('name', newCategoryName.trim())
            .single();

        if (existing) {
            setError(`Category "${newCategoryName.trim()}" already exists.`);
            setSavingCategory(false);
            return;
        }

        const { error } = await supabase
            .from('inventory_categories')
            .insert({ 
                name: newCategoryName.trim(), 
                is_active: true, 
                assigned_to: assigned 
            });

        if (error) {
            // Check for unique constraint violation (likely a soft-deleted record)
            if (error.code === '23505') { // unique_violation
                // Try to restore the deleted record
                const { data: restored, error: restoreError } = await supabase
                    .from('inventory_categories')
                    .update({ 
                        deleted_at: null,
                        is_active: true,
                        assigned_to: assigned,
                        updated_at: new Date().toISOString()
                    })
                    .eq('name', newCategoryName.trim())
                    .select();
                
                if (restoreError) throw restoreError;

                if (!restored || restored.length === 0) {
                     throw new Error(`Category "${newCategoryName.trim()}" exists (possibly deleted) but could not be restored. You may not have permission to modify it.`);
                }
            } else {
                throw error;
            }
        }

        setNewCategoryName('');
        setNewCategoryAssignedKitchen(false);
        setNewCategoryAssignedBar(false);
        setNewCategoryAssignedStorekeeper(false);
        setAddCategoryOpen(false);
        setCategoriesReloadKey((k) => k + 1);
        onStructureChange?.();
    } catch (e: any) {
        setError(e.message);
    } finally {
        setSavingCategory(false);
    }
  }

  async function saveCollection() {
    if (!newCollectionName.trim() || !selectedCategoryName) return;
    setSavingCollection(true);
    
    try {
        if (!supabase) throw new Error('Supabase client not initialized');
        const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
        if (!ok) {
            setError('Session expired. Please sign in again.');
            setSavingCollection(false);
            return;
        }

        const category = categories.find(c => c.name === selectedCategoryName);
        if (!category) throw new Error("Category not found");

        // Check if active collection exists
        const { data: existing } = await supabase
            .from('inventory_collections')
            .select('id')
            .eq('name', newCollectionName.trim())
            .eq('category_id', category.id)
            .is('deleted_at', null)
            .maybeSingle();

        if (existing) {
            setError(`Collection "${newCollectionName.trim()}" already exists in this category.`);
            setSavingCollection(false);
            return;
        }

        const { error } = await supabase
            .from('inventory_collections')
            .insert({ 
                name: newCollectionName.trim(), 
                category_id: category.id, 
                is_active: true 
            });

        if (error) {
             // Check for unique constraint violation (likely a soft-deleted record)
             if (error.code === '23505') { // unique_violation
                 // Try to restore the deleted record
                 const { data: restored, error: restoreError } = await supabase
                     .from('inventory_collections')
                     .update({ 
                         deleted_at: null,
                         is_active: true,
                         updated_at: new Date().toISOString()
                     })
                     .eq('name', newCollectionName.trim())
                     .eq('category_id', category.id)
                     .select();
                 
                 if (restoreError) throw restoreError;

                 if (!restored || restored.length === 0) {
                     throw new Error(`Collection "${newCollectionName.trim()}" exists (possibly deleted) but could not be restored. You may not have permission to modify it.`);
                 }
             } else {
                 throw error;
             }
        }

        setNewCollectionName('');
        setAddCollectionOpen(false);
        setCollectionsReloadKey((k) => k + 1);
        onStructureChange?.();
    } catch (e: any) {
        setError(e.message);
    } finally {
        setSavingCollection(false);
    }
  }

  async function toggleCategoryActive(cat: CategoryRow) {
    if (!canEditStructure) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) {
          setError('Session expired. Please sign in again.');
          return;
      }

      const { error } = await supabase
        .from('inventory_categories')
        .update({ is_active: !cat.active, updated_at: new Date() })
        .eq('id', cat.id);
        
      if (error) throw error;

      setCategoriesReloadKey((k) => k + 1);
      onStructureChange?.();
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  async function toggleCollectionActive(col: CollectionRow) {
    if (!canEditStructure) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) {
          setError('Session expired. Please sign in again.');
          return;
      }

      const { error } = await supabase
        .from('inventory_collections')
        .update({ is_active: !(col.active ?? true), updated_at: new Date() })
        .eq('id', col.id);

      if (error) throw error;

      setCollectionsReloadKey((k) => k + 1);
      onStructureChange?.();
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  function openEditCategory(cat: CategoryRow) {
    if (!canEditStructure) return;
    setEditCategoryTarget(cat);
    const assigned = cat.assigned_to ?? [];
    setEditAssignedKitchen(assigned.includes('kitchen'));
    setEditAssignedBar(assigned.includes('bar'));
    setEditAssignedStorekeeper(assigned.includes('storekeeper'));
    setEditCategoryOpen(true);
  }

  async function saveEditCategoryAssignments() {
    if (!editCategoryTarget) return;
    try {
      if (!supabase) { setError('Supabase is not configured.'); return; }
      
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { setError('Session expired. Please sign in again.'); return; }

      const assigned: string[] = [];
      if (editAssignedKitchen) assigned.push('kitchen');
      if (editAssignedBar) assigned.push('bar');
      if (editAssignedStorekeeper) assigned.push('storekeeper');
      
      const { error } = await supabase
        .from('inventory_categories')
        .update({ assigned_to: assigned, updated_at: new Date() })
        .eq('id', editCategoryTarget.id);

      if (error) throw error;

      setEditCategoryOpen(false);
      setEditCategoryTarget(null);
      setCategoriesReloadKey((k) => k + 1);
      onStructureChange?.();
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }



  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {message && (
        <div className="bg-green-50 text-green-700 p-4 rounded-md flex items-center gap-2 border border-green-200">
          <IconCheckCircle className="w-5 h-5" />
          {message}
        </div>
      )}
      
      {error && (
        <div className="bg-error-light text-error p-4 rounded-md flex items-center gap-2 border border-error-light">
          <IconAlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Categories Column */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <IconBox className="w-5 h-5 text-primary" />
              Categories
            </h2>
            {canEditStructure && (
              <Button size="sm" onClick={() => setAddCategoryOpen(true)}>
                <IconPlus className="w-4 h-4 mr-1" />
                Add Category
              </Button>
            )}
          </div>

          <SearchInput 
            value={categorySearch}
            onChangeValue={setCategorySearch}
            onClear={() => setCategorySearch('')}
            placeholder="Search categories..."
            className="mb-4"
            fullWidth
          />
          <div className="space-y-3">
            {loadingCategories ? (
              <div className="text-center py-12 flex flex-col items-center justify-center gap-2 text-gray-500">
                <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                Loading categories...
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <IconBox className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-900 font-medium mb-1">No categories yet</p>
                <p className="text-sm text-gray-500">Create your first category to get started.</p>
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No matching categories found.</div>
            ) : (
              paginatedCategories.map((cat: CategoryRow) => (
                <div 
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategoryName(cat.name);
                    // Scroll to collections on mobile
                    if (window.innerWidth < 768) {
                      setTimeout(() => {
                        collectionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 100);
                    }
                  }}
                  className={`
                    p-4 rounded-xl cursor-pointer transition-all duration-200 border
                    ${selectedCategoryName === cat.name 
                      ? 'bg-green-50 border-green-200 shadow-sm scale-[1.02]' 
                      : 'bg-white border-gray-100 hover:border-green-200 hover:shadow-md'
                    }
                  `}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className={`font-semibold ${selectedCategoryName === cat.name ? 'text-green-800' : 'text-gray-900'}`}>
                          {cat.name}
                        </h3>
                        {!cat.active && <Badge variant="warning">Inactive</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {cat.assigned_to?.map((role: string) => (
                          <span key={role} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 capitalize">
                            {role}
                          </span>
                        ))}
                        {(!cat.assigned_to || cat.assigned_to.length === 0) && (
                          <span className="text-xs text-gray-400 italic">No assignments</span>
                        )}
                      </div>
                    </div>
                    
                    {canEditStructure && (
                      <div className="flex flex-col gap-1">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 text-gray-500 hover:bg-white/50" 
                          onClick={(e) => { e.stopPropagation(); openEditCategory(cat); }}
                          title="Edit Assignments"
                        >
                          <IconEdit className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className={`h-8 w-8 p-0 hover:bg-white/50 ${cat.active ? 'text-green-600' : 'text-gray-400'}`}
                          onClick={(e) => { e.stopPropagation(); toggleCategoryActive(cat); }}
                          title={cat.active ? "Deactivate" : "Activate"}
                        >
                          <IconCheckSquare className="w-4 h-4" />
                        </Button>
                        {(isManager || isAdmin) && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-white/50"
                            onClick={(e) => { e.stopPropagation(); promptDeleteCategory(cat); }}
                            title="Delete Category"
                          >
                            <IconTrash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {filteredCategories.length > CATEGORY_PAGE_SIZE && (
            <Pagination
              currentPage={categoryPage}
              totalPages={Math.ceil(filteredCategories.length / CATEGORY_PAGE_SIZE)}
              onPageChange={setCategoryPage}
              className="mt-4"
            />
          )}
        </div>

        {/* Collections Column */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <IconChevronRight className="w-5 h-5 text-primary" />
              Collections
            </h2>
            {canEditStructure && (
              <Button 
                size="sm"  ref={collectionsRef}
                onClick={() => setAddCollectionOpen(true)}
                disabled={!selectedCategoryName}
              >
                <IconPlus className="w-4 h-4 mr-1" />
                Add Collection
              </Button>
            )}
          </div>

          {!selectedCategoryName ? (
            <div className="bg-gray-50 rounded-lg p-4 flex items-center justify-between border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white rounded-md border border-gray-200 shadow-sm">
                  <IconChevronRight className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Select a category</p>
                  <p className="text-xs text-gray-500">View collections and items</p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <SearchInput 
                value={collectionSearch}
                onChangeValue={setCollectionSearch}
                onClear={() => setCollectionSearch('')}
                placeholder="Search collections..."
                className="mb-4"
                fullWidth
              />
              <div className="space-y-3">
                {loadingCollections ? (
                  <div className="text-center py-8 text-gray-500">Loading collections...</div>
                ) : collections.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-500">No collections found for {selectedCategoryName}.</p>
                  </div>
                ) : filteredCollections.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No matching collections found.</div>
                ) : (
                  paginatedCollections.map((col: CollectionRow) => (
                    <Card key={col.id} className="p-4 flex items-center justify-between hover:shadow-sm transition-all duration-200">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{col.name}</span>
                          {!col.active && <Badge variant="warning">Inactive</Badge>}
                        </div>
                      </div>
                      
                      {canEditStructure && (
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className={`h-8 w-8 p-0 ${col.active ? 'text-green-600' : 'text-gray-400'}`}
                            onClick={() => toggleCollectionActive(col)}
                            title={col.active ? "Deactivate" : "Activate"}
                          >
                            <IconCheckSquare className="w-4 h-4" />
                          </Button>
                          {(isManager || isAdmin) && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-white/50"
                              onClick={() => promptDeleteCollection(col)}
                              title="Delete Collection"
                            >
                              <IconTrash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>
              {filteredCollections.length > COLLECTION_PAGE_SIZE && (
                <Pagination
                  currentPage={collectionPage}
                  totalPages={Math.ceil(filteredCollections.length / COLLECTION_PAGE_SIZE)}
                  onPageChange={setCollectionPage}
                  className="mt-4"
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Add Category Modal */}
      <Modal 
        isOpen={addCategoryOpen} 
        onClose={() => setAddCategoryOpen(false)}
        title="Add Category"
      >
        <div className="space-y-4">
          <Input
            label="Category Name"
            placeholder="e.g. Food"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign To</label>
            <div className="flex flex-col gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
              <Checkbox 
                label="Kitchen Staff" 
                checked={newCategoryAssignedKitchen} 
                onChange={(e) => setNewCategoryAssignedKitchen(e.target.checked)} 
              />
              <Checkbox 
                label="Bar Staff" 
                checked={newCategoryAssignedBar} 
                onChange={(e) => setNewCategoryAssignedBar(e.target.checked)} 
              />
              <Checkbox 
                label="Storekeeper" 
                checked={newCategoryAssignedStorekeeper} 
                onChange={(e) => setNewCategoryAssignedStorekeeper(e.target.checked)} 
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setAddCategoryOpen(false)}>Cancel</Button>
            <Button onClick={saveCategory} isLoading={savingCategory} disabled={!newCategoryName.trim()}>Save Category</Button>
          </div>
        </div>
      </Modal>

      {/* Add Collection Modal */}
      <Modal 
        isOpen={addCollectionOpen} 
        onClose={() => setAddCollectionOpen(false)}
        title="Add Collection"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-500 mb-2">
            Adding collection to <span className="font-semibold text-gray-900">{selectedCategoryName}</span>
          </div>
          <Input
            label="Collection Name"
            placeholder="e.g. Breakfast"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
          />

          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setAddCollectionOpen(false)}>Cancel</Button>
            <Button onClick={saveCollection} isLoading={savingCollection} disabled={!newCollectionName.trim()}>Save Collection</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Category Assignments Modal */}
      <Modal 
        isOpen={editCategoryOpen} 
        onClose={() => setEditCategoryOpen(false)}
        title="Edit Category Assignments"
      >
        {editCategoryTarget && (
          <div className="space-y-4">
            <div className="text-sm text-gray-500 mb-2">
              Category: <span className="font-semibold text-gray-900">{editCategoryTarget.name}</span>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assign To</label>
              <div className="flex flex-col gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                <Checkbox 
                  label="Kitchen Staff" 
                  checked={editAssignedKitchen} 
                  onChange={(e) => setEditAssignedKitchen(e.target.checked)} 
                />
                <Checkbox 
                  label="Bar Staff" 
                  checked={editAssignedBar} 
                  onChange={(e) => setEditAssignedBar(e.target.checked)} 
                />
                <Checkbox 
                  label="Storekeeper" 
                  checked={editAssignedStorekeeper} 
                  onChange={(e) => setEditAssignedStorekeeper(e.target.checked)} 
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setEditCategoryOpen(false)}>Cancel</Button>
              <Button onClick={saveEditCategoryAssignments}>Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={`Delete ${deleteTarget?.type === 'category' ? 'Category' : 'Collection'}`}
      >
        <div className="space-y-4">
            <div className="bg-red-50 text-red-800 p-4 rounded-md flex items-start gap-3">
                <IconAlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                    <p className="font-medium">Are you sure?</p>
                    <p className="text-sm mt-1">
                        You are about to delete the {deleteTarget?.type} <strong>{deleteTarget?.name}</strong>.
                        {deleteTarget?.type === 'category' && " This will also disable all associated collections and items."}
                    </p>
                </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-4">
                <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting}>Cancel</Button>
                <Button 
                    onClick={executeDelete} 
                    disabled={isDeleting}
                    isLoading={isDeleting}
                    className="bg-red-600 hover:bg-red-700 text-white"
                >
                    Confirm Delete
                </Button>
            </div>
        </div>
      </Modal>
    </div>
  );
}
