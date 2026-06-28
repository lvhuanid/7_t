from typing import Literal
from IPython.display import Image, display

# 1. 从 .env 加载 DeepSeek API Key
from dotenv import load_dotenv
load_dotenv()

# 2. 导入 LangChain 相关库
from langchain.tools import tool
from langchain.messages import AnyMessage, SystemMessage, HumanMessage, ToolMessage
from typing_extensions import TypedDict, Annotated
import operator
from langgraph.graph import StateGraph, START, END

# 3. 导入 DeepSeek 模型
from langchain_deepseek import ChatDeepSeek

# --- 工具定义 (保持不变) ---
@tool
def multiply(a: int, b: int) -> int:
    """Multiply a and b."""
    return a * b

@tool
def add(a: int, b: int) -> int:
    """Adds a and b."""
    return a + b

@tool
def divide(a: int, b: int) -> float:
    """Divide a and b."""
    return a / b

# 4. 初始化 DeepSeek 模型并绑定工具
model = ChatDeepSeek(
    model="deepseek-chat",  # 推荐使用 "deepseek-chat"
    temperature=0
)

tools = [add, multiply, divide]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = model.bind_tools(tools)

# --- 状态、节点和图定义 (与之前完全一致) ---
class MessagesState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    llm_calls: int

def llm_call(state: MessagesState):
    return {
        "messages": [
            model_with_tools.invoke(
                [
                    SystemMessage(
                        content="You are a helpful assistant tasked with performing arithmetic on a set of inputs."
                    )
                ]
                + state["messages"]
            )
        ],
        "llm_calls": state.get('llm_calls', 0) + 1
    }

def tool_node(state: MessagesState):
    result = []
    for tool_call in state["messages"][-1].tool_calls:
        tool = tools_by_name[tool_call["name"]]
        observation = tool.invoke(tool_call["args"])
        result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
    return {"messages": result}

def should_continue(state: MessagesState) -> Literal["tool_node", END]:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tool_node"
    return END

agent_builder = StateGraph(MessagesState)
agent_builder.add_node("llm_call", llm_call)
agent_builder.add_node("tool_node", tool_node)
agent_builder.add_edge(START, "llm_call")
agent_builder.add_conditional_edges(
    "llm_call",
    should_continue,
    ["tool_node", END]
)
agent_builder.add_edge("tool_node", "llm_call")
agent = agent_builder.compile()

# 可视化与运行
display(Image(agent.get_graph(xray=True).draw_mermaid_png()))

messages = [HumanMessage(content="Add 3 and 4.")]
result = agent.invoke({"messages": messages})
for m in result["messages"]:
    m.pretty_print()