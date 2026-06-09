export function successResponse<T>(data: T, message = 'Operation successful') {
  return { success: true, message, data };
}

export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
  message = 'Operation successful',
) {
  return {
    success: true,
    message,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
}
