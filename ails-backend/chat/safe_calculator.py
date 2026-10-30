"""Bounded AST arithmetic with exact rational decimal literals; never eval/exec."""
import ast
from decimal import Decimal, localcontext
from fractions import Fraction


def calculate(expression):
    expression = str(expression or "").strip()
    if not expression or len(expression) > 512:
        raise ValueError("Expression must contain 1 to 512 characters.")
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, RecursionError):
        raise ValueError("Invalid arithmetic expression.") from None
    if len(list(ast.walk(tree))) > 100:
        raise ValueError("Expression is too complex.")

    def bounded(value):
        if value.numerator.bit_length() > 4096 or value.denominator.bit_length() > 4096:
            raise ValueError("Calculation exceeds the numeric limit.")
        return value

    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            literal = ast.get_source_segment(expression, node).replace("_", "")
            if isinstance(node.value, int):
                return bounded(Fraction(node.value))
            try:
                number = Decimal(literal)
                if not number.is_finite() or abs(number.adjusted()) > 1000:
                    raise ValueError()
                return bounded(Fraction(number))
            except (ValueError, ArithmeticError):
                raise ValueError("Number is outside the supported range.") from None
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add): value = left + right
            elif isinstance(node.op, ast.Sub): value = left - right
            elif isinstance(node.op, ast.Mult): value = left * right
            elif isinstance(node.op, ast.Div): value = left / right
            elif isinstance(node.op, ast.FloorDiv): value = Fraction(left // right)
            elif isinstance(node.op, ast.Mod): value = left % right
            elif isinstance(node.op, ast.Pow):
                if right.denominator != 1 or abs(right) > 100 or left.numerator.bit_length() * abs(right) > 4096 or left.denominator.bit_length() * abs(right) > 4096:
                    raise ValueError("Exponent must be an integer between -100 and 100 within the numeric limit.")
                value = left ** int(right)
            else: raise ValueError("Unsupported arithmetic operator.")
            return bounded(value)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            args = [visit(arg) for arg in node.args]
            name = node.func.id
            if name == "abs" and len(args) == 1: return abs(args[0])
            if name in {"min", "max"} and 1 <= len(args) <= 20:
                return (min if name == "min" else max)(args)
            if name == "round" and 1 <= len(args) <= 2:
                digits = args[1] if len(args) == 2 else Fraction(0)
                if digits.denominator != 1 or abs(digits) > 50:
                    raise ValueError("Rounding digits must be an integer between -50 and 50.")
                return Fraction(round(args[0], int(digits)))
            if name == "sqrt" and len(args) == 1 and args[0] >= 0:
                # Decimal sqrt is rounded at 50 significant digits, explicitly marked below.
                with localcontext() as ctx:
                    ctx.prec = 50
                    return bounded(Fraction((Decimal(args[0].numerator) / Decimal(args[0].denominator)).sqrt()))
        raise ValueError("Only arithmetic and the documented calculator functions are allowed.")

    try:
        value = visit(tree.body)
    except (ArithmeticError, OverflowError):
        raise ValueError("Calculation is undefined (for example division by zero).") from None
    with localcontext() as ctx:
        ctx.prec = 50
        rendered = str(Decimal(value.numerator) / Decimal(value.denominator))
    return {"status": "ready", "expression": expression, "result": rendered,
            "fraction": str(value), "precision": 50,
            "approximate": any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "sqrt" for n in ast.walk(tree))}
