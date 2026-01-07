# Changelog

## [0.1.0] - 2026-01-06

### Added
- Delta input mode for Bar, Kitchen, and Storekeeper stock forms.
- Display of previous stock changes (saved values) in consumption tables.
- Real-time stock calculation updates based on delta inputs.

### Fixed
- Bar and Kitchen opening stock now correctly uses Storekeeper's data as the source of truth.
- Resolved issues with stock data persistence and display in consumption tables.
- Aligned backend RPC functions (`get_daily_stock_sheet`, `get_expected_opening_stock_batch`) with frontend requirements.
- Fixed type definitions for Kitchen stock data.

### Changed
- Updated `package.json` version to 0.1.0.
