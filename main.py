from typing import Literal
from langgraph.graph import StateGraph, MessagesState, START, END

# 1. 定义节点
def oracle(state: MessagesState):
    # 模拟 LLM 决定是否需要调用工具
    last_message = state["messages"][-1].content
    return {"messages": [{"role": "ai", "content": f"思考：用户说了 {last_message}"}]}

def call_tool(state: MessagesState):
    return {"messages": [{"role": "ai", "content": "【执行工具】正在查询天气..."}]}

def respond_directly(state: MessagesState):
    return {"messages": [{"role": "ai", "content": "【直接回复】你好，很高兴见到你！"}]}

# 2. 定义条件路由函数（决定去向）
def router(state: MessagesState) -> Literal["call_tool", "__end__"]:
    last_message = state["messages"][-1].content
    # 如果用户的话里包含 "天气"，就去调工具，否则直接结束
    if "天气" in last_message:
        return "call_tool"
    return "__end__"

# 3. 构建图
workflow = StateGraph(MessagesState)
workflow.add_node("oracle", oracle)
workflow.add_node("call_tool", call_tool)

workflow.add_edge(START, "oracle")
# 增加条件边：从 oracle 出发，由 router 函数决定去 call_tool 还是 END
workflow.add_conditional_edges("oracle", router)
workflow.add_edge("call_tool", END)

graph = workflow.compile()

# 测试包含“天气”的输入
print(graph.invoke({"messages": [{"role": "user", "content": "今天天气怎么样？"}]}))

print(graph.get_graph().draw_mermaid())