import { PaginatedResult, PaginationMeta } from '../dto/pagination.dto';

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export function getPaginationParams(page = 1, limit = 20): { skip: number; take: number } {
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}
