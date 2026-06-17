export type SegmentType = 'AISLE' | 'BAY' | 'LEVEL' | 'SPACE';

export interface Segment {
  fullName: string;
  type: SegmentType;

  // Optional backend metadata (absent for the hardcoded demo data). id is used
  // when real stock occupancy is available; isLeaf marks non-rack floor
  // locations (goods-in/packing) the goods builder also fills.
  id?: number;
  isLeaf?: boolean;

  coordinateX: number;
  coordinateY: number;
  coordinateZ: number;

  dimensionX: number;
  dimensionY: number;
  dimensionZ: number;

  offsetX: number;
  offsetY: number;
  offsetZ: number;
}
