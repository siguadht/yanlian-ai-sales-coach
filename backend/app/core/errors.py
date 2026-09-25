class AppError(Exception):
    """统一业务错误：code + message，不携带堆栈。"""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str = "资源不存在"):
        super().__init__("NOT_FOUND", message)
